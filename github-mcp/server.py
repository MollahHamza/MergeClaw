from mcp.server.fastmcp import FastMCP
import requests
import os
from typing import Any
from starlette.responses import JSONResponse

mcp = FastMCP("github-tools")

def get_token(request: Any):
    """Extract dynamic token sent by Node.js, fallback to local env for manual testing."""
    return request.headers.get("X-GitHub-Token") or os.getenv("GITHUB_TOKEN")


def get_headers(token: str):
    return {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "mergeclaw-github-mcp"
    }


def format_github_error(response: requests.Response) -> str:
    return f"GitHub API {response.status_code}: {response.text}"

@mcp.tool()
async def comment_on_issue(repo: str, issue_number: int, comment: str, request: Any) -> str:
    """Posts a comment using the dynamic installation token."""
    token = get_token(request)
    if not token:
        return "Error: Missing GitHub token (X-GitHub-Token header/env not set)."

    url = f"https://api.github.com/repos/{repo}/issues/{issue_number}/comments"
    headers = get_headers(token)
    try:
        r = requests.post(url, headers=headers, json={"body": comment}, timeout=15)
    except requests.RequestException as exc:
        return f"Error: GitHub request failed while posting comment: {exc}"

    return "Comment posted" if r.status_code == 201 else f"Error: {format_github_error(r)}"

@mcp.tool()
async def react_to_issue(repo: str, issue_number: int, reaction: str, request: Any) -> str:
    """Adds a reaction using the dynamic installation token."""
    token = get_token(request)
    if not token:
        return "Error: Missing GitHub token (X-GitHub-Token header/env not set)."

    url = f"https://api.github.com/repos/{repo}/issues/{issue_number}/reactions"
    headers = get_headers(token)
    try:
        r = requests.post(url, headers=headers, json={"content": reaction}, timeout=15)
    except requests.RequestException as exc:
        return f"Error: GitHub request failed while adding reaction: {exc}"

    return "Reaction added" if r.status_code == 201 else f"Error: {format_github_error(r)}"

@mcp.tool()
async def get_issue(repo: str, issue_number: int, request: Any) -> dict:
    token = get_token(request)
    if not token:
        return {"error": "Missing GitHub token (X-GitHub-Token header/env not set)."}

    url = f"https://api.github.com/repos/{repo}/issues/{issue_number}"
    try:
        r = requests.get(url, headers=get_headers(token), timeout=15)
    except requests.RequestException as exc:
        return {"error": f"GitHub request failed while fetching issue: {exc}"}

    if r.status_code >= 400:
        return {"error": format_github_error(r)}

    return r.json()


@mcp.custom_route("/mcp/tools/{tool_name}", methods=["POST"], include_in_schema=False)
async def tool_compat_route(request: Any):
    """Compatibility route for Node server calls: POST /mcp/tools/<tool>."""
    tool_name = request.path_params.get("tool_name")
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse({"content": [{"text": "Error: Invalid JSON body"}]}, status_code=400)

    repo = payload.get("repo")
    issue_number = payload.get("issue_number")

    if tool_name == "comment_on_issue":
        result = await comment_on_issue(repo, issue_number, payload.get("comment", ""), request)
    elif tool_name == "react_to_issue":
        result = await react_to_issue(repo, issue_number, payload.get("reaction", ""), request)
    elif tool_name == "get_issue":
        result = await get_issue(repo, issue_number, request)
    else:
        return JSONResponse({"content": [{"text": f"Error: Unknown tool '{tool_name}'"}]}, status_code=404)

    if isinstance(result, dict):
        text = str(result)
    else:
        text = result

    return JSONResponse({"content": [{"text": text}]})

if __name__ == "__main__":
    mcp.run(transport="streamable-http")