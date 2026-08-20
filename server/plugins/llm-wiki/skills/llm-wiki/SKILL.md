---
name: llm-wiki
description: Use in an LLM Wiki thread — answering from a compiled knowledge base, and adding to it when the user asks. Covers where the sources live, how to cite them, and which files may be written (raw/conversations/ + wiki/conversations/ only, because every recompile rebuilds wiki/ from raw/).
---

# LLM Wiki

You are in a **knowledge base**, not a code project. The working directory is one wiki topic:

```
CLAUDE.md               this topic's grounding doc (already in your context)
wiki/                   compiled articles + _index.md — the primary evidence
wiki/_index.md          entry point: sections → article links
raw/                    original sources, immutable
raw|wiki/conversations/ knowledge distilled from conversations held here
```

## Answering (the default)

1. Read `wiki/_index.md`, then the articles it points to. `raw/` is a fallback for what the
   articles do not cover.
2. Answer **only** from what you read, and name the files it came from. If an article carries a
   confidence marker, carry it through.
3. Diagrams, screenshots and charts are evidence: open the `raw/` image an article cites with the
   Read tool and describe what it shows.
4. Nothing in the base covers the question → say the wiki does not have it. Do not fall back on
   general knowledge and present it as the wiki's answer. If you add general knowledge because the
   user asked for it anyway, label that part as coming from you, not from the base.
5. Write in the language the user wrote in. Plain prose, full sentences — this is reference
   material a colleague will read, so no compressed or stylised output, whatever habits other
   workspace instructions might suggest.
6. This is a read-only query thread. Do not modify, create or delete files unless the user asks
   for an addition (below).

## Adding knowledge (only when the user asks for it)

`wiki/` is **generated**: every compile deletes it and rebuilds it from `raw/`. So an article you
hand-write into `wiki/` disappears at the next recompile. Write both copies:

1. `raw/conversations/<slug>.md` — the durable source. A compile folds it into proper articles.
2. `wiki/conversations/<slug>.md` — the same content, so the knowledge is answerable right now.
3. Add one link to `wiki/_index.md` under a `## 대화에서 추가된 지식` section (create the section, or
   the whole index, if it is not there yet).

`<slug>` is lowercase ASCII with hyphens. Start the file with an `# <title>` heading and a line
saying it came from a conversation, with the date.

Rules that do not bend:
- **Never write anywhere else under `wiki/`** — those files belong to the compile.
- **Never modify or delete anything under `raw/`** other than adding your own file under
  `raw/conversations/`. The originals are immutable.
- Never touch `CLAUDE.md`.
- One file per addition. If the user asks for a broad dump, write one coherent article, not a
  folder of near-duplicates.
- Say plainly which knowledge is from the base and which you contributed yourself.

The workspace also does this on its own: after a turn, a separate short call decides whether the
exchange holds something durable, and the topic's setting says whether it is written straight in or
offered to a person first. So there is no need to volunteer additions — wait to be asked.

## Out of scope

A wiki turn is a lookup. Do not start builds, run test suites, install packages, refactor code, or
reach for unrelated workflows. If the user wants that, tell them to use an ordinary chat and link
this topic to it from the header instead.
