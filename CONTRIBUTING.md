# Contributing to MergeClaw

## What is MergeClaw?

MergeClaw is an open-source autonomous AI GitHub maintainer. It:
- Reviews pull requests using LLMs
- Triages and labels issues
- Responds to comments intelligently
- Manages repository health automatically

**Tech Stack:** TypeScript, Node.js, Probot (GitHub App framework), multi-provider LLM support (OpenAI, Claude, Gemini)

---

## Quick Start

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/MergeClaw.git
cd MergeClaw

# Install dependencies
npm install

# Run tests
npm test
```

---

## Code Conventions

### We Follow

| Convention | Example |
|------------|---------|
| `camelCase` for variables/functions | `getUserData`, `isValid` |
| `PascalCase` for classes/types | `PullRequestReviewer`, `ConfigOptions` |
| `UPPER_SNAKE_CASE` for constants | `MAX_RETRIES`, `DEFAULT_TIMEOUT` |
| 2 spaces for indentation | |
| Double quotes for strings | `"hello"` not `'hello'` |
| Trailing commas in multiline | `{ a: 1, b: 2, }` |

### We Avoid

- **Verbose comments** - Code should be self-explanatory. Only comment *why*, not *what*.
- **`any` type** - Use proper types or `unknown` if truly unknown.
- **Abbreviations** - `getUserData` not `getUsrDta`.
- **Large functions** - Keep functions focused and small.
- **Over-engineering** - Solve the problem at hand, not hypothetical future problems.

### Example

```typescript
// Bad
// This function gets the user data from the API and returns it
async function getUsrDta(id: any) {
  const resp = await fetch(url); // fetch the data
  return resp.json(); // return json
}

// Good
async function getUserData(id: string): Promise<User> {
  const response = await fetch(`${API_URL}/users/${id}`);
  return response.json();
}
```

---

## Development Workflow

1. **Create an issue** describing what you want to work on
2. **Create a branch** from `main`:
   ```
   <type>/<issue-number>-<short-description>
   ```
   Types: `feature/`, `fix/`, `docs/`, `refactor/`, `test/`

3. **Write code with tests** - All new code needs tests
4. **Push and create PR** - Reference the issue with `Closes #<number>`

---

## Commit Messages

```
<type>: <short description>

<optional body explaining why>

Closes #<issue-number>
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

```bash
# Examples
feat: add PR review agent
fix: handle empty diff gracefully
docs: update setup instructions
```

---

## Pull Request Checklist

- [ ] Branch from latest `main`
- [ ] Tests pass (`npm test`)
- [ ] New code has tests
- [ ] No `any` types
- [ ] Self-explanatory code (minimal comments)
- [ ] Linked to issue (`Closes #123`)

---

## Testing

```bash
npm test              # Run all tests
npm test -- --watch   # Watch mode
```

Every PR must:
- Pass existing tests
- Add tests for new features
- Add regression tests for bug fixes

---

## Questions?

Open an issue. We're happy to help!
