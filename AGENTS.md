# ChatGPT project context

This directory is a local mirror of the ChatGPT project “SaaS demo wtv”.

- Treat every file under `sources/` as read-only reference material.
- Do not edit, rename, move, or delete synced project files.
- These files may be replaced the next time a task is created from this ChatGPT project.


## Project instructions

## SaaS development instructions

### Product
This is a Next.js + Supabase multi-tenant SaaS for small service businesses.

### Core rules
- Preserve Supabase auth and RLS.
- Never disable RLS to make something work.
- Never expose service-role credentials client-side.
- Reuse existing components, routes, tables, and helpers before creating new ones.
- Do not add dependencies unless necessary.
- Do not redesign or refactor unrelated parts of the app.
- Make the smallest change necessary to complete the requested task.
- Keep workspace/business isolation intact.

### Efficiency
- Inspect only files relevant to the task.
- Do not perform repository-wide audits unless requested.
- Do not rewrite working code without a concrete reason.
- Do not add optional polish after the task is complete.
- Stop once the acceptance criteria are met.
- Prefer targeted fixes over architecture rewrites.

### Database
- Every business-owned record must be scoped by business_id.
- Keep all multi-tenant data protected by RLS.
- Jobs should reference customers through customer_id.
- Avoid duplicate legacy/new fields.
- Preserve existing data during migrations.

### Public intake
- Anonymous users must not have broad access to jobs or customers.
- Validate and limit public input.
- Keep uploads private and scoped to the correct business/job.

### UI
- Preserve the current SaaS design language.
- Keep mobile layouts usable.
- Avoid duplicate buttons and placeholder features.
- Use real database data.

### Testing
- Test the affected workflow.
- Run lint/build when relevant.
- Fix errors caused by the change.
- Do not perform a full-app audit for every small task.

### Do not build unless explicitly requested
- Invoices
- Payments
- Stripe
- Full marketing automation
- AI features
- Payroll
- Route optimization
- Large architecture rewrites
- Unrelated cleanup

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
