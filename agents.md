This is the mono-repo for public open-source deployment that is created at deployment time from root source projects.
Do not ever update apps projects like samsar-processor, samsar-ai-video-generation-listener etc. directly from within this project. 
When those projects are referenced it usually means the root projects which will be built to create this mono-repo.

Make edits here only when this project is directly referenced.
It contains clones of several other source projects for final deployment.

Use `develop` as the integration branch for new issue work. Sync sibling source
projects into `develop`, run CI, and merge validated changes into `main` through
a pull request. When `main` advances independently, update `develop` from it
without rewriting either branch's history. Direct pushes to `main` require an
explicit request. The `sync:promote` command still targets `main`; do not use it
for the normal `develop` workflow.
