from mcp.server.fastmcp import FastMCP
import inspect
import json
import requests
import os
import base64
from typing import Any
from starlette.responses import JSONResponse

mcp = FastMCP("github-tools")

# Extracts the GitHub token from the incoming request headers or local environment variables.
def get_token(request: Any):
    """Extract dynamic token sent by Node.js, fallback to local env for manual testing."""
    token = request.headers.get("X-GitHub-Token")
    if token:
        return token

    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()

    return os.getenv("GITHUB_TOKEN")

# Constructs the standard HTTP headers required for authenticating and formatting GitHub API requests.
def get_headers(token: str):
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mergeclaw-github-mcp"
    }

# Formats a failed HTTP response from GitHub into a readable string containing the status code and text.
def format_github_error(response: requests.Response) -> str:
    return f"GitHub API {response.status_code}: {response.text}"

# Ensures a valid token exists for the current request, returning an error message if it is missing.
def ensure_token(request: Any):
    token = get_token(request)
    if not token:
        return None, "Error: Missing GitHub token (X-GitHub-Token/Authorization/env not set)."
    return token, None

# A helper wrapper that executes standard HTTP requests to the GitHub API with built-in error handling.
def github_request(method: str, path: str, token: str, *, body: dict | None = None, params: dict | None = None):
    url = f"https://api.github.com{path}"
    try:
        response = requests.request(
            method=method,
            url=url,
            headers=get_headers(token),
            json=body,
            params=params,
            timeout=20,
        )
    except requests.RequestException as exc:
        return None, f"Error: GitHub request failed ({method} {path}): {exc}"

    return response, None



# Posts a standard text comment on a specific GitHub issue or pull request.
@mcp.tool()
async def comment_on_issue(repo: str, issue_number: int, comment: str, request: Any) -> str:
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("POST", f"/repos/{repo}/issues/{issue_number}/comments", token, body={"body": comment})
    if request_error: return request_error
    return "Comment posted" if r.status_code == 201 else f"Error: {format_github_error(r)}"

# Adds an emoji reaction (like +1, rocket, heart) to the main body of an issue or pull request.
@mcp.tool()
async def react_to_issue(repo: str, issue_number: int, reaction: str, request: Any) -> str:
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("POST", f"/repos/{repo}/issues/{issue_number}/reactions", token, body={"content": reaction})
    if request_error: return request_error
    return "Reaction added" if r.status_code == 201 else f"Error: {format_github_error(r)}"

# Retrieves the full details, status, and metadata of a specific issue.
@mcp.tool()
async def get_issue(repo: str, issue_number: int, request: Any) -> dict:
    token, token_error = ensure_token(request)
    if token_error: return {"error": token_error}
    r, request_error = github_request("GET", f"/repos/{repo}/issues/{issue_number}", token)
    if request_error: return {"error": request_error}
    if r.status_code >= 400: return {"error": format_github_error(r)}
    return r.json()

# Retrieves high-level metadata about a repository, such as description, star count, and default branch.
@mcp.tool()
async def get_repository(repo: str, request: Any) -> dict:
    token, token_error = ensure_token(request)
    if token_error: return {"error": token_error}
    r, request_error = github_request("GET", f"/repos/{repo}", token)
    if request_error: return {"error": request_error}
    if r.status_code >= 400: return {"error": format_github_error(r)}
    return r.json()

# Fetches a paginated list of issues in a repository, filterable by open or closed state.
@mcp.tool()
async def list_issues(repo: str, state: str = "open", request: Any = None) -> dict:
    token, token_error = ensure_token(request)
    if token_error: return {"error": token_error}
    r, request_error = github_request("GET", f"/repos/{repo}/issues", token, params={"state": state, "per_page": 30})
    if request_error: return {"error": request_error}
    if r.status_code >= 400: return {"error": format_github_error(r)}
    return {"issues": r.json()}

# Changes the status of an open issue to closed.
@mcp.tool()
async def close_issue(repo: str, issue_number: int, request: Any) -> str:
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("PATCH", f"/repos/{repo}/issues/{issue_number}", token, body={"state": "closed"})
    if request_error: return request_error
    return "Issue closed" if r.status_code == 200 else f"Error: {format_github_error(r)}"

# Reopens an issue that was previously closed.
@mcp.tool()
async def reopen_issue(repo: str, issue_number: int, request: Any) -> str:
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("PATCH", f"/repos/{repo}/issues/{issue_number}", token, body={"state": "open"})
    if request_error: return request_error
    return "Issue reopened" if r.status_code == 200 else f"Error: {format_github_error(r)}"

# Applies an array of label strings (like 'bug', 'enhancement') to an issue.
@mcp.tool()
async def add_issue_labels(repo: str, issue_number: int, labels: list[str], request: Any) -> str:
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("POST", f"/repos/{repo}/issues/{issue_number}/labels", token, body={"labels": labels})
    if request_error: return request_error
    return "Labels added" if r.status_code == 200 else f"Error: {format_github_error(r)}"

# Retrieves the full details, branch information, and merge status of a Pull Request.
@mcp.tool()
async def get_pull_request(repo: str, pull_number: int, request: Any) -> dict:
    token, token_error = ensure_token(request)
    if token_error: return {"error": token_error}
    r, request_error = github_request("GET", f"/repos/{repo}/pulls/{pull_number}", token)
    if request_error: return {"error": request_error}
    if r.status_code >= 400: return {"error": format_github_error(r)}
    return r.json()

# Posts a standard comment to the main conversation timeline of a Pull Request.
@mcp.tool()
async def comment_on_pull_request(repo: str, pull_number: int, comment: str, request: Any) -> str:
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("POST", f"/repos/{repo}/issues/{pull_number}/comments", token, body={"body": comment})
    if request_error: return request_error
    return "PR comment posted" if r.status_code == 201 else f"Error: {format_github_error(r)}"

# Attempts to merge an open Pull Request using the specified merge strategy (merge, squash, rebase).
@mcp.tool()
async def merge_pull_request(repo: str, pull_number: int, merge_method: str = "squash", request: Any = None) -> str:
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("PUT", f"/repos/{repo}/pulls/{pull_number}/merge", token, body={"merge_method": merge_method})
    if request_error: return request_error
    return "Pull request merged" if r.status_code == 200 else f"Error: {format_github_error(r)}"

# Lists all repositories the current GitHub App installation has permission to access.
@mcp.tool()
async def get_installation_repositories(request: Any) -> dict:
    token, token_error = ensure_token(request)
    if token_error: return {"error": token_error}
    r, request_error = github_request("GET", "/installation/repositories", token, params={"per_page": 100})
    if request_error: return {"error": request_error}
    if r.status_code >= 400: return {"error": format_github_error(r)}
    return r.json()

# Opens a brand new issue in the specified repository with a title and optional body.
@mcp.tool()
async def create_issue(repo: str, title: str, body: str = "", request: Any = None) -> str:
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("POST", f"/repos/{repo}/issues", token, body={"title": title, "body": body})
    if request_error: return request_error
    return "Issue created" if r.status_code == 201 else f"Error: {format_github_error(r)}"

# Fetches the raw diff file of a PR to allow the AI to review exact code additions and deletions.
@mcp.tool()
async def get_pr_diff(repo: str, pull_number: int, request: Any) -> str:
    """Gets the raw diff of a Pull Request so the AI can review code changes."""
    token, token_error = ensure_token(request)
    if token_error: return token_error
    headers = get_headers(token)
    headers["Accept"] = "application/vnd.github.v3.diff"
    url = f"https://api.github.com/repos/{repo}/pulls/{pull_number}"
    try:
        r = requests.get(url, headers=headers, timeout=20)
    except requests.RequestException as exc:
        return f"Error: GitHub request failed: {exc}"
    if r.status_code >= 400: return f"Error: {format_github_error(r)}"
    return r.text

# Retrieves the status and conclusion (success/failure) of the latest GitHub Actions CI runs.
@mcp.tool()
async def get_workflow_runs(repo: str, branch: str = None, request: Any = None) -> dict:
    """Fetches the status of recent GitHub Actions CI/CD runs."""
    token, token_error = ensure_token(request)
    if token_error: return {"error": token_error}
    params = {"branch": branch} if branch else {}
    r, request_error = github_request("GET", f"/repos/{repo}/actions/runs", token, params=params)
    if request_error: return {"error": request_error}
    if r.status_code >= 400: return {"error": format_github_error(r)}
    data = r.json()
    summary = [{"name": run.get("name"), "status": run.get("status"), "conclusion": run.get("conclusion")} for run in data.get("workflow_runs", [])[:5]]
    return {"latest_runs": summary}

# Assigns one or more GitHub usernames to a specific issue or pull request.
@mcp.tool()
async def assign_issue(repo: str, issue_number: int, assignees: list[str], request: Any) -> str:
    """Assigns users to an issue or pull request."""
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("POST", f"/repos/{repo}/issues/{issue_number}/assignees", token, body={"assignees": assignees})
    if request_error: return request_error
    return "Assigned successfully" if r.status_code == 201 else f"Error: {format_github_error(r)}"

# Decodes and returns the plaintext contents of a specific file located at the given repository path.
@mcp.tool()
async def get_file_content(repo: str, path: str, request: Any) -> str:
    """Gets the plaintext content of a specific file in the repository."""
    token, token_error = ensure_token(request)
    if token_error: return token_error
    r, request_error = github_request("GET", f"/repos/{repo}/contents/{path}", token)
    if request_error: return request_error
    if r.status_code >= 400: return f"Error: {format_github_error(r)}"
    data = r.json()
    if data.get("encoding") == "base64":
        try:
            return base64.b64decode(data["content"]).decode("utf-8")
        except Exception as e:
            return f"Error decoding file: {e}"
    return "Error: File is not readable text or is a directory."


# NEW TOOLS ADDED FOR CODE EXPLORATION & REVIEW

# Retrieves a clean list of all file paths that have been modified, added, or deleted in a specific PR.
@mcp.tool()
async def list_pr_files(repo: str, pull_number: int, request: Any = None) -> dict:
    """Gets a list of all files modified in a Pull Request."""
    token, token_error = ensure_token(request)
    if token_error: return {"error": token_error}
    r, request_error = github_request("GET", f"/repos/{repo}/pulls/{pull_number}/files", token, params={"per_page": 100})
    if request_error: return {"error": request_error}
    if r.status_code >= 400: return {"error": format_github_error(r)}
    
    files = [{"filename": f["filename"], "status": f["status"], "additions": f["additions"], "deletions": f["deletions"]} for f in r.json()]
    return {"changed_files": files}

# Recursively fetches the entire directory tree to provide the AI with a map of all file paths in the repo.
@mcp.tool()
async def get_repo_tree(repo: str, branch: str = "main", request: Any = None) -> dict:
    """Gets the full directory structure (all file paths) of the repository to map the codebase."""
    token, token_error = ensure_token(request)
    if token_error: return {"error": token_error}
    r, request_error = github_request("GET", f"/repos/{repo}/git/trees/{branch}?recursive=1", token)
    if request_error: return {"error": request_error}
    if r.status_code >= 400: return {"error": format_github_error(r)}
    
    data = r.json()
    paths = [item["path"] for item in data.get("tree", []) if item["type"] == "blob"]
    if len(paths) > 1000:
        return {"warning": "Repo too large, showing first 1000 files.", "files": paths[:1000]}
    return {"files": paths}

# Searches the repository for a specific text query or keyword and returns the paths of matching files.
@mcp.tool()
async def search_repo_code(repo: str, query: str, request: Any = None) -> dict:
    """Searches for specific code snippets, functions, or text across the entire repository."""
    token, token_error = ensure_token(request)
    if token_error: return {"error": token_error}
    
    q = f"{query} repo:{repo}"
    r, request_error = github_request("GET", "/search/code", token, params={"q": q, "per_page": 10})
    if request_error: return {"error": request_error}
    if r.status_code >= 400: return {"error": format_github_error(r)}
    
    results = [item["path"] for item in r.json().get("items", [])]
    return {"found_in_files": results}

# Submits a formal Pull Request review, allowing the AI to officially APPROVE or REQUEST_CHANGES.
@mcp.tool()
async def create_pull_request_review(repo: str, pull_number: int, event: str, body: str, request: Any = None) -> str:
    """Submits an official PR Review. 'event' must be APPROVE, REQUEST_CHANGES, or COMMENT."""
    token, token_error = ensure_token(request)
    if token_error: return token_error
    
    payload = {"event": event, "body": body}
    r, request_error = github_request("POST", f"/repos/{repo}/pulls/{pull_number}/reviews", token, body=payload)
    if request_error: return request_error
    return f"Review submitted as {event}" if r.status_code == 200 else f"Error: {format_github_error(r)}"


# ROUTING

# Custom FastAPI route that intercepts HTTP POST requests from Node.js and dynamically maps them to the appropriate MCP tool function.
@mcp.custom_route("/mcp/tools/{tool_name}", methods=["POST"], include_in_schema=False)
async def tool_compat_route(request: Any):
    """Compatibility route for Node server calls: POST /mcp/tools/<tool>."""
    tool_name = request.path_params.get("tool_name")
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"content": [{"text": "Error: Invalid JSON body"}]}, status_code=400)

    # Dictionary mapping tool name strings to their actual Python function definitions.
    available_tools = {
        "comment_on_issue": comment_on_issue,
        "react_to_issue": react_to_issue,
        "get_issue": get_issue,
        "get_repository": get_repository,
        "list_issues": list_issues,
        "close_issue": close_issue,
        "reopen_issue": reopen_issue,
        "add_issue_labels": add_issue_labels,
        "get_pull_request": get_pull_request,
        "comment_on_pull_request": comment_on_pull_request,
        "merge_pull_request": merge_pull_request,
        "get_installation_repositories": get_installation_repositories,
        "create_issue": create_issue,
        "get_pr_diff": get_pr_diff,
        "get_workflow_runs": get_workflow_runs,
        "assign_issue": assign_issue,
        "get_file_content": get_file_content,
        "list_pr_files": list_pr_files,
        "get_repo_tree": get_repo_tree,
        "search_repo_code": search_repo_code,
        "create_pull_request_review": create_pull_request_review,
    }

    tool_fn = available_tools.get(tool_name)
    if not tool_fn:
        return JSONResponse({"content": [{"text": f"Error: Unknown tool '{tool_name}'"}]}, status_code=404)

    sig = inspect.signature(tool_fn)
    call_kwargs = {}
    
    # Iterates through the required arguments of the tool and assigns them from the incoming request payload.
    for param_name, param in sig.parameters.items():
        if param_name == "request":
            call_kwargs[param_name] = request
            continue

        if param_name in payload:
            call_kwargs[param_name] = payload[param_name]
            continue

        if param.default is inspect._empty:
            return JSONResponse(
                {"content": [{"text": f"Error: Missing required field '{param_name}' for tool '{tool_name}'"}]},
                status_code=400,
            )

    result = await tool_fn(**call_kwargs)

    # Ensures the output is properly serialized to a JSON string before sending it back to Node.js.
    if isinstance(result, dict):
        text = json.dumps(result)
    elif isinstance(result, list):
        text = json.dumps(result)
    else:
        text = result

    return JSONResponse({"content": [{"text": text}]})

if __name__ == "__main__":
    mcp.run(transport="streamable-http")