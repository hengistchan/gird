# Compact Conversation

Execute a conversation compact and save the summary to the project's compact history.

## Instructions

1. **Perform a compact** of the current conversation, summarizing all important context, decisions made, work completed, and any pending tasks.

2. **Save the compact** to `.claude/compacts/` directory with a filename based on the current timestamp:
   - Filename format: `YYYY-MM-DD_HH-MM.md`
   - Example: `2025-02-12_14-30.md`

3. **Compact file format** should include:
   - **Date**: When the compact was created
   - **Summary**: High-level overview of what was discussed/accomplished
   - **Key Decisions**: Important decisions made during the conversation
   - **Work Completed**: List of completed tasks with file references
   - **Pending/In-Progress**: Tasks that were started but not finished
   - **Context for Next Session**: Any critical context needed to continue work
   - **Related Files**: Key files that were modified or discussed

4. **Create the compacts directory** if it doesn't exist.

5. **After saving**, confirm the compact was saved successfully and show the file path.

## Notes

- Use timestamps in the local timezone
- Keep summaries concise but comprehensive enough to resume work
- Include code snippets only if they're critical context
- Reference plan files in `.claude/plans/` if relevant
