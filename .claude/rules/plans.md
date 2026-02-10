# Project Planning Rule

**Location:** `.claude/plans/`

All implementation plans for this project MUST be written in the `.claude/plans/` directory at the project root.

When creating a new plan:
1. Create a new markdown file in `.claude/plans/` with a descriptive name
2. Use the format: `[feature-name].md` or `[phase-number]-[description].md`
3. Include Context, Phases, File Lists, and Verification Steps
4. Reference existing plans in `.claude/plans/` before creating new ones

Example plan file:
```
.claude/plans/
├── phase1-auth-system.md
├── phase2-rbac.md
├── phase3-webhooks.md
└── saas-phase1-expansion.md
```
