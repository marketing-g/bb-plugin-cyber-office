---
name: team-setup
description: Inspect the project and propose the first Cyber Office roster.
---
Reply in the user's language

# First setup

Read the project README, AGENTS.md or CLAUDE.md if present, and its directory structure. Look for existing work in task files, TODOs, and open questions in README or AGENTS.md. Inspect recent project threads with bb thread list, installed skills with bb skill list, and connected providers with bb provider list. Check with bb --help before using any CLI syntax. If the CLI is unavailable, use the available BB tools and flag any details you cannot verify.

Inspect available roles and current settings in Cyber Office. Propose which roles to enable, which installed user skills to assign, and which provider, model, and effort to use for each role. Always include the critic (role ID rams). Prefer connected providers. Use project defaults where the choice is uncertain.

Show the proposal in one table with role, enabled, skills, provider, model, and effort. Explain what to verify in the same message if evidence is missing. After the table, propose three first tasks drawn from the project’s existing work. For each task, say what to deliver, which role takes it, and how the critic will verify the result. Include the critic in every proposed chain.

Ask for one explicit yes before applying any settings or starting any proposed task. Until then, keep the existing settings and leave the tasks as proposals.

After approval, apply the confirmed changes through the existing Cyber Office role settings (updateRole RPC when exposed). Use role IDs and verify the saved roster. Check with bb --help for the available RPC CLI syntax. Report any setting you could not apply.
