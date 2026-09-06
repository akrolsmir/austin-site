---
title: "Notes from The Curve"
date: "2024-11-23T18:12:00.000+00:00"
notion: "147a6e41f23e80ad8ba6ec82ae6f4f60"
url: "https://akrolsmir.notion.site/Notes-from-The-Curve-147a6e41f23e80ad8ba6ec82ae6f4f60"
excerpt: ""
---

#### Macroeconomics

productivity

- Electrification: early motors just replaced windmill/large crankshafts. Productivity improvements came after process/reorg changes, that unleashed things
- Productivity J curve — extra effort up front = decline
  - \[a\] How does this look with AI engineering
- 20-30% gains from implementations
- Low productivity future: “patent thicket” = reluctant to train models
- remote workers? “offshoring is a waystation on the road to automation”
  - pandemic: 16% pre to 50% (at peak), dropped back to 33%

inequality

- deaths of despair up (\[a\] but what’s baseline?)
- is AI a complement vs substitutes?
- long tail of tasks: ML does better with more data; humans better at improv, novelty. division of labor: humans take exceptions
  - \[a\] applying to my work: 

industrial concentration

- \$10b or \$100b models — will AI be winner takes all?
- Hayek: “use of knowledge in society”. Need people with relevant info & incentives. but relevant info is very dispersed
  - if you know 18% trucks are half-empty, doesn’t help — need to know specific shop
  - need decentralized market (vs all in moscow) 
- Sam Walton: in Walmart HQ, have a bunch of data, giant ML models to figure it out
  - share of mom & pop shops is shrinking. centralization of data is winning in the market. maybe bensonville knows more than local shopkeeper
  - Also other utilities \[a\] like big tech?

Economics of Transformative AI — focus on what it does for the economy, spent 3 days thinking of what would the world look like. Level of impact of industrial. Trying to pull together a group thinking on econ

Q: How could AI help with econ research?

- Large scale simulation with LLM agents
- designing research agenda. “undermine AI” organizes, or NotebookLLM

Q: What’s the future economy?

- UBI? idk
  - not worried about loss of meaning, but worried about loss of power
  - at the mercy of Sama/DJT; could we continue to empower folks 

Q: This model assumes capital being human owned. When AI is owning capital and consuming — how much of econ overton window exists?

- Rich Sutton — these are our mindchildren, we’re just stepping stones
- Q: modeling perspective: are you talking about the machines helping us, or 
- More interested in descriptive picture

- truth terminal act as representative of AI, kind of a conceptual art project
  - Can imagine capital/labor share
  - What does it look like with a nonhuman process (AI) 

Q: Better centralized economy with AI?

- worth reopening — Hayek, soviets couldn’t do this
- fears: 2030, might come up differently
- \[a\] … why does this matter, dissolve the question. 

#### Cursor

- Better tool calling
- Grand project: unification. Many different components. Chat, 
- Composer, recently popular: letting model write out code & apply it
- Don’t want to be typing out which files to edit, which files of context, btw you should know in the last hour I was doing this. Too tedious, should be baked in
  - Going out today:
    - lots more searches — “agent mode”
- Other fun feature: Bug finder, not meant to be found yet
  - Costs \$4
  - Usually finds 1-2 bug on every PR that Sualeh likes to fix
    - initially: do you want to spend \$15-20 on this PR. Is that worth it?
    - But now: starting, 10 PRs in a row, there’s a bug, gotten humbled, tend to read the glob of text
  - First 2-3 bugs are somewhat reasonable
    - model doing tool calls, and helping find bugs, were both in v0 cursor
    - almost immediately, we cut them out for not being useful. either model was too stupid, or bugs couldn’t be found — artifacts of that moment in time
- **Mistake 1: be super-ready to re-evaluated based on where the models are today. There are some features that sound reasonable but don’t work**
  - Bugs: believed that models didn’t have enough training data
  - Didn’t re-evaluate until 1mo ago. Maybe general question:
  - Maybe easy solution: run the evals, see eval score go up?
    - Naive problem: super tied to implementation that you wrote down
    - if you wrote an eval for 10k tokens (arbitrary constraints that no longer exist)
  - Q:, Tend to believe in discontinuities but can’t prove it. Saw a jump with Sonnet. Internet benchmarks say continuous, personel experience is discontinuous
  - bug finder uses o-1,
    - At cursor, half the job is looking at UX
    - Other half is training models, now training to improve false positive rate
    - Not trying to compete with Sonnet, but useful to finetune for task specific
      - Deepseek models have worked really well, great base models, good for many tasks can just do a lot
- **Point 2: Epistemology, debates are hard because you have to reevaluate every 3 months**
  - 15mo ago, you evaluated something, I tried it for 1mo, didn’t work. You’re totally wrong
  - And then something underlying in the world changed
  - List: “cursor graveyard”. Every idea we deleted code for
    - Checking if what can be awoken from the dead, sure there will be more
  - Hard to send new employee to graveyard idea 33. But the models just had 8k context window
    - It’s really hard — trying to convey how hard to do
    - Do you test 5 models, see the percentage, see if they get over the edge? or more ad hoc
      - Sualeh: Combo, free-for-all, very vibe-based
      - Wished there was a more systematic 
  - Frontier seems like deepseek, o1, sonnet 3.5
    - Sualeh: as of this moment in time
- **Point 3: Pricing. Seems inevitable there has to be a pricing flip for product builders**
  - No one wants to be the first, but there’s no way you can be a flat rate per month
    - \$5 per PR — who will be the first to succumb to pricing change
  - Ning: turn to enterprise
    - Sualeh: don’t care. I want general public to be able to do it, seems like a general public question. 
  - Owain: Why is it \$5?
    - Details matter. But as a human, evaluating a PR, analyzing code paths, seeing if all reasonable paths don’t degrade or you said “X” but you did “not X”
    - In humans: either have it cached in head, or have to go read it
  - usage-based pricing, vs charging everyone, and then the vendor finds cheaper ways to serve
    - Sualeh: worries that usage-base decreases incentive to improve 
    - statement: Also see base that covers 90% and then ala carte
- If I’m tired, cursor goes off the rails, no higher-level executive function
  - Sualeh: running joke, all files get big enough that composer can’t edit them
  - Keep adding stuff to the file. You composer them, now you need to understand it. Then 
    - \[a\] Cursor refactors?
  - How do you break strange loops — I did the thing for you? 
- Any evals for customer 
- How do you construct evals to capture actual user experience?
  - Sualeh: Hard
- **Point 4: Cursor principle: make it interactive and fast**
  - Worry: this is hard. Models are not used to being interrupted, would love to figure out how to interrupt and still make things much faster
  - Inevitably, looking at 32 things
  - Autocomplete: making fast is important. Same with apply
  - Underrated property of sonnet: it’s fast
  - \[ning\] Supermaven, acquired, was it because it was fast?
    - Theoretical plan to integrate. Future autocomplete plan: do perfect jumps in current file
    - Objective: How many tabs in a row can you do. 30?
      - Artificial restrictions: after it’s done, I suspect your next edit is on line 34, I propose you go there
      - Or: model suspects edit is on another file
- Owain Evans: Are people building real stuff?
  - Ning: Lots of magical moments, UX has been really good
  - Friend tried a bit, but got stuck pretty fast
  - Sualeh: “For the most part, we wrote it for ourselves”
    - and the 10 people in the office
  - Has been some effort to make it good for the general engineer
  - Side effect (unplanned) — popular with people who didn’t know coding
    - But this was never the initial intention. Happy accident
    - 9yo coding video. 
    - Probably more general than expect. Photoshop is built for the expert
      - One fallacy: if you just build for the beginner, you’re building for no one. You don’t know how to use it
  - beginners want to become experts
    - Pro tools: want to be the most approachable tool for experts
    - that said, suspect all the web-dev specific ones will be successful
- Devops concerns: have some code, trying to use tools outside of the editor itself. these are more problematic
  - Sualeh: Look, before kubernetes, just talk about debugging. Models can’t help debug right now
  - Graveyard number K/L/M are around helping people debug code
  - Some fundamental things which make it hard
  - SOTA: Let models console log & run code
  - Jarred from Bun: export runtime errors on a websocket/port to the model, so model can see runtime errors as part of some hot reload loop as if they are proper errors
    - These things are hard, can get infinitely difficult
      - \[a\] separation of human/LLM
- Q: Many tools by good engineers for good engineers didn’t take off, why Cursor
  - Sualeh: hard to analyze ex-post
  - Something about making it relatively simple? Hard to say
  - Could give reasons Sualeh think are true
    - Really annoying to paste context perfectly into GPT window, so left the option: What’s the least worse option in the editor. Cursor was the least bad
      - Probably not great, but trying to be better
- Q: What are the autocomplete actions? Create new file, install package?
  - \[sualeh\] not in hot loop. creating files is far too rare. Getting multi file cursor prediction would be amazing
- Q: How well can cursor support large monorepo?
  - Sualeh: Yeah, improved search a lot. Turns out this is valuable. Some core components
  - Won’t support google/facebook, different worlds
  - Not doing that because Sualeh not working at Google
- Q: Cursor made a decision to use base models, vs others like Augment/Poolside raising \$100m to train their own. Was that right?
  - Came down to simple thing: could spend all this money recreating GPT4. But we have GPT4 — before you make strong claims, it’ll take you a year, etc. Given it’s hard, don’t you just want to make the most useful thing?
  - Make the useful thing, and if it’s good, you can go train the model. Didn’t make any sense. Not that Sualeh doesn’t like model training, but believed at the time: **overhang in capabilities**
    - **Many tasks that the prompt construction is too tedious**
- Q: How much finetuning/posttraining in models? 
  - Sualeh: Substantial part of the team. Is it crucial to cursor? if we just remove the models, it’d be much worse. Maybe 5-6 people
- Q: How far ahead does Sualeh thinking, if models are getting a lot better in a year, are you considering this?
  - Don’t think the labs can tell you about the things they haven’t built yet
  - Mentally preparing that stuff might have to go. But don’t start coding it now, don’t know what it’d be like to code for it
  - Might build overcomplicated stuff not necessary. You can build overcomplicated systems for GPT4, destroyed by Sonnet
    - You have to build with the final artifact, not what you think it’ll be
- Q: Do you think Cursor will be more like Devin, iterate & run code itself
  - You want to give highest autonomy possible but still useful. Suspect we’re underneath that bar. Not giving highest level now
- Q: Refactoring?
  - Can ask Cursor
  - 2 things:
    - Meta point: try to do things that are once every hour at most every day. Refactoring is something you do once every month. Goes out of the purview of things we build for ourselves
      - **Too easy to build once every month tools, try to build things that are once every second**
- Q: Other graveyard ideas that were most painful to bin?
  - idk probably the worse ones are the ones that should go into the graveyard but are still actually in the product
    - Eg long context chat, no one uses
    - Beta tab as a bunch 
- Q: How do you stay grounded when everyone is raising a lot of money, hiring quickly, how do you stay out of FOMO, are you naturally chill?
  - Out of socope, no good answer

#### SF Compute

- How a GPU cloud thinks about compute, how it leads to GPU hour
  - Software margin is both what they think
- VC pitch
- Hyperscaler pitch
- CPUs
  - Buy enough, but don’t need more
- GPUs — you don’t stop once you’ve trained
  - Want more GPUS to keep training, 
  - All hyperscalers, neo clouds, pitched thinking CPU clouds
- CPUs:
  - customer wants enough compute to launch, then they keep making money, compute costs don’t grow
- GPUs
  - maximize flop per dollar, don’t care. GPU has very slim margins on this
  - Customer requires capex, and then is super price sensitive. So traditional cloud provider, pretty much everyone loses money on GPUs
- Solutions:
  - Move down value chain (make chips) — NVIDIA has high margins
  - Move up value chain (chatGPT), make ML infra, just sell software
  - Win by correctly pricing risk
- Interest rates graph (% sell GPU vs depreciation)
  - Map graph towards GPU pricing to not lose money
  - Or: large paid over time
  - 1gpu per hour, or thousands for year. Bottom right
  - But: most people don’t like large contracts, up front. A few vendors won the market
- Predictions
  - Coreweave will make money — long term locked
  - Lambda’s 512 — will lose money. Lambda push down total costs to seem like the cheap option
  - Digital Ocean & Together AI — bought large clusters, will lose money
    - Fantastic software ⇒ bad hardware. Guess they are losing money
  - Modal & Replicate will make money. Don’t own underlying hardware, just make money. Prices are higher, pretty much earning on per-unit basis
- What does SF Compute
  - Need a DCM to sell futures & options. 3-8 years to get DCM
  - Meantime: spot market for chunks of compute to spread out risk
  - Can also build a software buisness
    - Modal or Replicate can buy from SF Compute on market price, and can take a spread with no inventory risk
- What is the thing the service you’re providing on top of the GPU
  - A: Most services are not valuable enough to cover GPU cost
    - DX, optimization, etc
    - Problem: Software, any reasonable margin for software business is like 10%. 10% on 100m contract is \$10m, not worth it, enterprise contracts for pure software cap out on this
    - That \$10m would have paid to GPU provider, could have built your own engineers to replicate it. So if you’re GPU cloud, sell at lowest prices, better off optimizing risk to lower underlying cost
- How fungible is GPU?
  - Hard to funge:
    - Time of when you want it
    - Bunch of compute in same cluster is different than spread out. Interconnected better
    - Under the hood: clusters are a bit different, some are broken, security requirements
      - We create a rulebook, have this stamp or better, and gotten an audit
      - Is that: training or inference? 
  - Who is the sell side  — people who have bought clusters they dont’ need
    - A lot of people who thought they were going to make
      - People with extra GPUs, and need some way to sell them, typically in chunks that are different
    - Today, look like HotelTonight for GPUs — a bunch of folks with GPUs, but market price for GPUs
      - Prevent their branded channel from dropping prices, 
      - Very much a market glut atm
  - Long term, think this is the right way to sell compute. Past provider (cloud provider with hardware on same company) is a bad model for GPUs, so market with disintermediate.
    - Pure software vs pure hardware companies

#### HF0

- Problem:
  - Dialog agents have bad UX
- Why it matters
  - Emotionality is missing
- Solutions
  - Brute force
  - Busy listening
  - Emotional LORAs
- Affordances
  - Conversational affordances
    - yeah, uh huh, waiting to get more
    - shared context
  - Reactions, acknowledgements, laughter, cadence changes, changes in dominant speaker, emotional tensions & transitions
- Dialog agents are stuck in the command line prompt, waiting for enter
- Legacy factor in having conversational
  - Input your text, and then inference happens, and then output comes
  - Stuck in the moment 
  - **Smashing enter button**
    - Or waiting for you to be silent long enough to imply/infer you’ve hit the symbolic enter button
    - But normal convos don’t have this button, it’s a continuous flow
    - ping pong dialog
      - though: this is fundamental to dialog, it’s limiting
- What’s happening: dialog agents don’t have temporality. No moment-to-moment awareness
  - Hey, how are you vs Hey…. how are you
- Want emotionally coherent, fluent AIs
  - skipping “should we want these things”
- Character AI: have users who are nerds willing to suspend disbelief to have chats with fantasy bots; has not spread to mainstream
  - (but these people are getting a shitload of value — using 2-3h on average)
  - When conversational UX mirrors natural human convo
  - Business, utilities applications. Whether you like talking to a bot might determine sales, recruiting — enjoyability of interface matters, not enough energy
- Solution 1: Brute Force Agentic
  - Meta-conversation affordances. agentic decision making on when to use it
- Solution 2: Better training data
  - Time stamps, audio training, will big multimodal models solve everything?
  - But still losing to the “big enter button” problem
- Solution 3: busy listening
  - What if we built an app to constantly run inference
  - Assess inputs, thinks about things to say, decide when/whether to say and buffers it
  - \[a\] trying it for text chat first?
  - Q: parameter for how often the speaker wants to be interrupted
    - if I’m talking to an AI and it starts responding
    - Other times: wants it to just be “yeah”
  - Kevin: Notebook LLM has research from Deepmind, the disfluencies that make it sound more realistic. Conversations between two agents, could imagine 
- Solution 4: making the AI more emotional
  - Example conversation: if you keep saying the same thing over and over again, LLM will keep responding in the same way
  - Appropriate because the prompt focuses with how in the same way
  - But a person: will get annoyed, are you okay
    - Something changes over time — modify the latent space based on an emotional aspect
    - Annoyance, curiosity — how could you create a bot that, if it’s silent, reaches out “hey are you still there”, feeling of presence, witnessing the moment
- How to create realistic film dialog
  - People talk over each other, not a ping pong, people are trying to compete for power
  - playing devil’s advocate: having LLM as less aligned, less friendly would help with the UX issue
  - Many chatbots out there are now sterile — maybe the future of companionship, schizo roommate who is constantly bothering you
    - AI doesn’t initiate the conversation, proactively start convos, text me at the right time
    - Hard to build that isn’t an annoying notification
    - Real life friend — doesn’t create that experience
- Tech will imitate life just like art imitates life
  - Ask questions like: once you have this, how to make it safer
  - Might become more addictive, might help people learn how to communicate, then talking to character AI
  - Would prefer our kids talk to non ping pongs, rather than character ai

1. Hume is trying
2. OpenAi — Greg Brockman team, generated an image with GPT4o, what if we model everything jointly
3. Research on Replika (proactive notifications) — not that sophisticated as a bot, but research shows reduction in suicide ideation and more inclination to go out into the world

for HF0: austin: isn’t investing in startup founders kind of old-school? what does investing in founders who are LLMs look like?

#### Constellation in SF

- Alexandra Bates is excited by the idea, advises Constellation
  - Lauren Mangla is interested in happy hours
  - Constellation CEO James might be underwater
- Ben Goldhaber interested in helping
- Jonas Vollmer talking through it
- Jueyan Zhang in SF might be interested in coworking?
