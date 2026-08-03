This is the mono-repo for public open-source deployment that is created at deployment time from root source projects.
Do not ever update apps projects like samsar-processor, samsar-ai-video-generation-listener etc. directly from within this project. 
When those projects are referenced it usually means the root projects which will be built to create this mono-repo.

Make edits here only when this project is directly referenced.
It contains clones of several other source projects for final deployment.

The canonical working and sync branch for this monorepo is `main`. Sync sibling
source projects into `main`, commit and push `main`, and leave the monorepo
checked out on `main`. Do not use or update `develop` for monorepo work.
