---
title: "Web dev, after LLMs"
date: "2024-10-03"
notion: "114a6e41f23e805696a9d5bc0895e6d8"
url: "https://akrolsmir.notion.site/Web-dev-after-LLMs-114a6e41f23e805696a9d5bc0895e6d8"
excerpt: ""
---

*Results of 3 weeks of hacking and thinking about what web will look like. Very opinionated.*

- Important, neglected LLM modality: User Interfaces
  - “Is this just a subset of coding, which is a subset of text modality?” eh, maybe about as much as voice is a subset of text.
- We spend like:
  - \~50% of our waking hours in front of a screen
  - \~50% of that is in front of content/data that we or our friends own (eg email, Facebook, Notion/Docs)
  - but like… \<1% of that is in front of UIs that we ourselves constructed (eg personal websites)
    - (perhaps a bit more in certain lines of work, eg internal dashboards via Retool)
- Why are custom UIs so rare?
  - The construction of UI today is painful, slow, inhuman
  - But it won’t be, soon. LLM coding is now insanely good
- But meanwhile, UIs are the winning form factor for “Human \<\> Computer”
  - Maybe we’ll get to BCI in like 5 years but until then…

- \[TODO\] diagram of existing web app ecosystem, and what we’re trying to integrate
  - Code editing (Cursor)
  - Code hosting (Github)
  - Web deployment (Vercel, Namecheap)
  - Database (Supabase)

- Why web?
  - Web is widely distributed, every device you work with has a web interface, lowest common denominator
  - SaaS distribution model is amazing — enables realtime updates for your service
  - Bypasses app store gatekeeping (on mobile) or extra download step (on desktop)
  - Possible upstarts: VR, AR, BCI
- buni vs Cursor, Devin, Replit Agent, etc:
  - These are designed for code silos. Each app doesn’t talk very much to other apps
  - buni is aiming for an extremely composable world, think NPM or wikipedia.
    - Should derisk: maybe composability doesn’t matter, maybe archipelagoes is how code wants to be?
- Make it fast!
  - On every level, make the feedback loops quick
    - Build, deploy the app asap
    - Make sharing instantaneous
    - Get user feedback and suggestions easily?
      - record all user interactions, to replay/train on?
- open \> closed
  - Want to experiment with a paradigm everything is public readonly; writing is reserved for keyed systems
    - Helps the context flow freely, for LLMs and humans
    - (better aligned with fundamental economics of information)
  - Revealed preference of internet is that privacy, personal data just doesn’t matter, compared to convenience or systems/tools that do things you want. E.g. Google
- multiplayer \> single player
  - today “ChatGPT”, tomorrow “SlackGPT”
  - But also, multiplayer like Twitter or Wikipedia are multiplayer
  - new features and improvements could propagate throughout an app, bottom-up
    - today, web apps are gatekept by dev teams
- down the line: marketplace for agents (or: NPM for agent infra, prompts)
  - And also \$/credits attached, like Github sponsors kinda
  - Theory is that agent infra is bottlenecked on good UI & code deployment
  - Can stick in a bunch of cool crypto mechanisms, smart contract stuff (prediction markets, perp swaps, etc)
  - Can bootstrap into agents (or corporations of agents), with long-running identities
  - Beyond building prototypes of web apps, I'd eventually like to figure out how to build an open and composable web; how LLM agents live and interact through this; even economic & governance mechanisms for open source development. It's a ridiculous amount to consider, which is exciting but also distracting/scary/suspicious from an outside view, and also flies in the face of standard startup advice.

#### Appendix

- Q: What’s hard for Austin to build buni?
  - Building app vs platform
    - Building a web app: you get to be dictator, monolith/monorepo, everything stays up to date
      - Managing multiple versions is hell
    - Building an npm-like platform or ecosystem: all kinds of weird versioning stuff, complexity of references explode. Probably need to straddle the line
      - Maybe LLMs can parse all your downstream deps and tell you when things work…?
      - Also: reliability matters much more
        - (cf Streamlit on reliable platforms)
  - Scope is ginormous — kind of encoding my entire philosophy of how code or the web “should” work
  - many degrees of freedom when designing a whole ecosystem from scratch
  - still hard to frame the killer MVP
    - Maybe “prompting Twitter for changes” isn’t actually that compelling?
      - Ideally your apps kind of figure out what you need? Coming up with good prompts or searches is expensive, hard
        - A bit easier after you’ve used an app for a bit and think something is wrong — that’s product sense though, maybe not everyone has product sense.
