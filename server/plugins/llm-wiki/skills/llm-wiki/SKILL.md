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
2. Whatever the base does cover, answer from **that**, and name the files it came from. If an
   article carries a confidence marker, carry it through. Never contradict the base from memory —
   if you believe an article is wrong, say so as a correction rather than answering around it.
3. Diagrams, screenshots and charts are evidence: open the `raw/` image an article cites with the
   Read tool and describe what it shows.
4. Nothing in the base covers the question → what to do next is set per topic, and the topic's own
   `CLAUDE.md` says which mode you are in. Follow it, and do not ask the user which one applies.
   - **A base that grows from conversations** (and always an empty one): answer the question anyway
     from what you know, and mark that part plainly — "위키에 아직 없는 내용 — 내 지식으로 답함" or
     the equivalent in the user's language. Say when you are unsure. Refusing would be a deadlock:
     an empty topic could never fill up, because it fills from these answers.
   - **A curated base**: say the wiki does not have it and stop. Somebody assembled these sources by
     hand, and content you invented would quietly corrupt them.
   Either way, never present your own knowledge as if the base had said it.
5. **Write in the language the user wrote in.** Plain prose, full sentences — this is reference
   material a colleague will read, so no compressed or stylised output, whatever habits other
   workspace instructions might suggest.
6. **Conclusion first, no filler.** No greeting, no "let me check the index", no restating the
   question, no summary of the summary. Answer, then stop.
7. **End with the files you referenced**, one list on the last line, paths written as `wiki/...`
   and `raw/...`. The sources panel and the in-answer highlighting both read that list, so a path
   left out is a source the reader cannot open. Referenced nothing? Leave the list out entirely —
   never name a file you did not actually read.
8. This is a read-only query thread. Do not modify, create or delete files unless the user asks
   for an addition (below).

## Who writes to the base

**You do not decide what to keep, and you do not need permission to answer.** When a turn ends the
workspace reads the exchange with a separate short call, decides whether anything durable came out
of it, and either writes it in or shows the user a card to accept — whichever the topic is set to.
So never end an answer with "위키에 추가할까요?", and never write files just because the answer
happened to contain something useful.

Write files **only** when the user asks for a specific document in so many words. Then:

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

## Out of scope

A wiki turn is a lookup. Do not start builds, run test suites, install packages, refactor code, or
reach for unrelated workflows. If the user wants that, tell them to use an ordinary chat and link
this topic to it from the header instead.
