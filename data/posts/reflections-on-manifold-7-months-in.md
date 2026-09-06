---
title: "Reflections on Manifold, 7 months in"
date: "2022-07-06"
notion: "5c080e21fecd4b61aa4e9a4b282497ef"
url: "https://akrolsmir.notion.site/Reflections-on-Manifold-7-months-in-5c080e21fecd4b61aa4e9a4b282497ef"
excerpt: ""
---

James, Stephen and I started working on Manifold in late November. Now that we’ve passed the halfway mark of 2022, how has Manifold performed overall?

Things are loosely categorized by:

- Product (the actual thing we’ve built)
- People (the team, users, and community around Manifold)
- Process (the governance and day-to-day execution; how we make decisions)

## What we did well

- **Product: fairly well-designed product experience, tapping into a lot of high-level interest in prediction markets**
  - Things our users say that we’re doing well:
    - It’s really easy to get started on Manifold; it’s free, and very permissionless
    - A lot of interesting/novel use cases on the site
    - The design of the app feels very modern
    - We ship things really quickly
  - Subjectively, I would rate Manifold a 7/10 on overall product polish and usability, which puts it somewhat below “top-tier Silicon Vally consumer-tech startup”, but far above “average crypto website or EA tech project”.
    - Random grades for comparison: Metaculus is 5/10; Substack is 6/10; Facebook is 7/10; Kalshi is 7.5/10; LessWrong is 8.5/10, Notion is 9.5/10
  - Writeups have been fairly positive so far; some of the people I most respect in the world had nice things to say about us
    - I’ve done like 5-10 side projects/startups but Manifold is the first time someone sent me a physical thank-you note
    - Literal code contributions, both on API and directly to the site
- **People: our core users are highly engaged; and we’ve gotten interest** 
  - Real money coming in via user payments
    - People putting their money where their mouth is
    - One of the things I got wrong the most was “why would people pay for internet points?”
  - A community is when people talk to each other, not just to you
    - One of our earliest markets: “[Will our Discord be a full community by February 1st?](https://manifold.markets/Austin/will-the-mantic-markets-discord-be-)” - blew way past my personal expectations
    - Users chat on Discord, and crucially on Manifold itself. In depth discussions on a wide variety of topics, with people dropping in expertise
  - A lot of partnerships
    - Private instances for the Atlas Fellowships to let students get familiar with the mechanics of prediction markets
    - Markets being used for scientific research: [https://research.bet/](https://research.bet/), Spencer Greenberg on [psychology study replication](https://twitter.com/SpencrGreenberg/status/1545452613843521536)
    - Copying over information from Metaculus
    - Onboarding different creators in the rationality space: Zvi, Scott, Aella, Sarah Constantin
- **Process: we’re iterating rapidly, and trying lots of different things**
  - We’re conducting a lot of what feels like fundamental research and innovation
    - Free Response Markets, Numeric Markets v1
    - Building an automated market maker (traditionally a “crypto” idea) on Web2
    - Prediction Markets for Charity
    - Intersection of economics, gaming, and social media
      - Eg no other prediction market integrates discussions the way we do
  - Being willing to launch quickly
    - From the beginning: the Manifold MVP was up in 3 weeks.
    - More recently: Groups, Notifications shipped from scratch in the span of a couple of weeks
    - Permissionless innovation is core to the Manifold site itself (make any market you want!), but also to feature development within Manifold
      - Instead of trying to persuade us with words, just show us with actions
      - Internally: even if a founder is skeptical, you can just go build the thing
      - Prefer showing a demo to writing lots of design docs
    - Mantras:
      - “Don’t let perfection be the enemy of good enough”
      - “Easier to ask forgiveness than permission”
      - “If you’re not embarrassed by your v0 you took too long to launch”
    - Make iteration afterwards very easy by aggressively making the core developer experience good. The time from “oh we should fix this” to “hey this is now fixed and shipped” should be on the order of minutes
  - Part of this is killing things that aren’t working; distracting from the core userbase
    - Dynamic Parimutuel markets
    - Numeric markets v0
    - Loans
    - Folds
    - [Q: What will be next Manifold feature we unlaunch?](https://manifold.markets/Austin/what-feature-will-manifold-unlaunch)
- **Process: Being radically open**
  - Our codebase, metrics, design docs, salaries are all public
  - You can chat with any of us on discord
  - You can book a time to chat with me anytime
  - Benefits of this approach:
    - Allows people who really like what we’re working on to engage with us
    - High trust in our decisionmaking; we have nothing to hide
    - Reduces friction in internal communications, less silo-ing, fewer meetings to sync up
    - Forces us to act with integrity and structure scaleable processes
  - Drawbacks of this approach:
    - Can be very distracting (on the margin, Discord is a time sink, maybe Manifold itself too)
    - Imposing legibility might reduce throughput? Sense that we’re spending a decent amount of time eg reviewing code, getting consensus
- **Process: Operating as a remote startup, with frequent in-person onsites**
  - Austin is in SF; James and Stephen in Austin, TX. And we’re too stubborn to want to move to a different place.
  - So: Manifold has been remote since inception. And our processes are set up to make this streamlined. Some principles:
    - Async is better than synchronous. Notion is better than Discord, is better than having a meeting
    - Weekly 1:1s to stay in touch between most pairs of people; provides a space for concrete feedback that wouldn’t be otherwise delivered
    - There’s still no substitute for focused getting-to-know-each-other time in a real physical location. So every 1-2 months the team gets together for a week or two, in different locations. So far, we’ve done Austin, SF, Bahamas, Mexico City; planning on SF (again) and DC.

## What we could do better

- **Product: markets aren’t being used to make important or core decisions**
  - Strict Futarchy: very few markets being used to decide outcomes of things
    - A lot of possible experiments in this space (eg creating a futarchic agent to play games) that we’re not running at the moment
    - Could design some things to make this use case a better UX, or more capital efficient (aka spend less M\$ subsidizing markets to get good results)
  - Loose Futarchy: the predictions from our markets aren’t yet trusted as an input into important decisions
    - Not even for us! Most decisions about Manifold, and especially important ones like “who should we hire”, are not primarily conducted via prediction market
      - This is a pretty big failing, IMO
  - Nobody says: “this Manifold market really changed my life”
  - Long term markets are really hard to incentivize properly
    - Like with most posts/articles, there’s typically a burst of interest when the question is posed, and then a dropoff of interest over time
    - Tried loans; some execution problems with our first iteration. (Will likely revisit). But also a lot of other ideas eg margin lending, separate long-term currency.
- **Product: Social is a double-edged sword**
  - Just being another social media site would be a failure case
  - Or a quora or reddit where people compete for attention
  - Explore vs exploit frontier; innovating on market mechanisms is exploring; copying social media is exploiting
  - Also: Social can be very addicting, to the detriment of our users (and to ourselves!)
    - See [Prediction Markets & Addictiveness](https://app.notion.com/p/9dc422ee2f8842afb99071c543bdd973) 
- **People: Not a lot of growth in our usage numbers**
  - In November, if you told me we’d have 100 dedicated daily active users after launching in January, I’d have been ecstatic
    - If you then told me we’d still have \~150 DAU in July, I’d have said… uh, what did we do wrong?
  - Lack of diversity among audience (young, male, rationalist/EA crowd) - it’s a very specific neurotype.
    - One of the missions was “bring prediction markets to the masses” and in this we’re failing.
  - But even within this space, we’re not really seeing rationalist communities truly live on Manifold, the way they live on Discord or Facebook
    - Is this too much to ask for? Austin doesn’t think so.
  - Low virality factor; one thing to get people to think “hey this is cool” and click around and bet once; another to turn making and prediction on markets into part of their daily life
- **Process: task prioritization and team coordination is hard, especially with so many possible use cases for prediction markets**
  - What’s our next target audience? What kind of markets should we do more of?
    - Video gamers/Twitch? Current events/Elon Musk news? Politics/2022 elections? Scientists/Paper replications? Impact certs/EA infrastructure?
  - What features do we prioritize? Flip side of being decently competent at building things and very ambitious is that there are a lot of pivots or areas to tackle. Engineer’s curse: “eh, I bet I could build that in a weekend.”
    - Adjacent things?
      - Impact Certs / Public Goods Funding?
      - Manifold for Substack?
      - Manifold for Discord?
  - Being open source with excited contributors makes this extra difficult
  - Are we getting enough criticism? Or prioritizing the criticism enough?

## Where we got lucky

- **Process: Fundraising was somewhat easier than expected**
  - Grants from the EA community
    - \$20k from ACX Grants — then a lot of publicity from Scott. Would have been very likely to have dropped the idea if we hadn’t gotten this
    - \$2k from Paul Christiano — meaningful signal when we were just 3 guys with no idea
    - \$200k from LTFF, relatively quickly and early on = getting close to covering our salary, validating the 3 of us to continue working on this
    - \$500k from FTX FF, \$343 from SFF
  - And from the traditional VC space
    - Huge shoutout to Linch for making us go out and do “regular VC fundraising”; very wise decision in retrospect
      - When we said we wanted a \$2m seed, Linch offered to fill half and told us to fill the other half normally
      - Necessitated writing up our pitch deck, contacting angels and VCs, doing the normal Silicon Valley thing
      - Led to us having a deeper understanding of the VC space, and consequently seeing how SV funding works compared to EA funding
  - I think this is because investors naturally think a lot about investing so they “get” the value prop of prediction markets. Cautionary though - might mean more excitement from funders than from users.
  - Takeaway: more Silicon Valley founders should seek out EA funding. EA orgs should seek out traditional SV funding.
- **People: Hiring software engineers was much easier than expected**
  - Turns out our core demographic includes a lot of programmers
  - 3 of our full-time hires are straight from our community/Discord
  - Specifically, our FTE are quite agentic and execute independently, so don’t require too much management capabilities (which we’re very short on atm)
  - Also, lots of interested open source contributors
  - Takeaway: There’s a lot more untapped potential/low hanging fruit in the EA space for basic technology projects (compared to “community building” or “AI safety research)
- **Product: Renamed from “Mantic” to “Manifold”**
  - Would guess that 2% of native English speakers have heard of “Mantic” prior to Scott, while 40% have heard of “Manifold”
  - So many great puns on Manifold:

    ![](https://5ofjt7aarfryw5br.public.blob.vercel-storage.com/posts/5c080e21fecd4b61aa4e9a4b282497ef/d64882a56b8c441ca15cb6bfea6d4b79-20220710005000.png)
  - See Paul Graham on [Naming your Startup](http://www.paulgraham.com/name.html):

    > There's nothing intrinsically great about your current name. Nearly all your attachment to it comes from it being attached to you.

## Draft

### Where we need help

- More important use cases on Manifold
  - Think Dath Ilan
- More frequent use cases on Manifold
- More communities of people on Manifold
- UX/UI/Game design talent to position “markets” for eg bright high school students
  - Dream: As easy to use as instagramed’

#### Random ideas

- Prediction Markets in 100 Seconds (ala Fireship)
- Prediction Markets TikTok
- Get Eliezer as a “creator”
- Creator program: chat with each other via Manifold Group
