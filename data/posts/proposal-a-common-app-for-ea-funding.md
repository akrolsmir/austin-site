---
title: "Proposal: A Common App for EA Funding"
date: "2022-02-02"
notion: "5c0d7d70ab8644d6a5392d9a80046edc"
url: "https://akrolsmir.notion.site/Proposal-A-Common-App-for-EA-Funding-5c0d7d70ab8644d6a5392d9a80046edc"
excerpt: ""
---

### TL;DR

[Manifold Markets](https://manifold.markets/home) spent \~\$3k in opportunity costs just applying for grants. A common application, shared between different funders in the EA space, could save time for applicants and surface more projects to funders.

### Background

- Sources of grant funding Manifold has applied for:
  - [ACX Grants](https://astralcodexten.substack.com/p/apply-for-an-acx-grant)
  - [FTX EA Fellowships](https://forum.effectivealtruism.org/posts/sdjcH7KAxgB328RAb/ftx-ea-fellowships)
  - [EA Funds](https://funds.effectivealtruism.org/)
  - [Emergent Ventures](https://www.mercatus.org/emergent-ventures)
  - [Pluralism and Civil Exchange Grant](https://www.mercatus.org/tags/pluralism-and-civil-exchange)
  - [Paul Christiano’s bounty](https://sideways-view.com/2019/10/27/prediction-markets-for-internet-points/)
  - And we’re now considering [SFF](https://survivalandflourishing.fund/) through [Rethink Charity](https://rethink.charity/fiscal-sponsorship)
- Ballpark estimate: writing these applications up took about 1 fulltime day each
  - Let’s call it 7 days \* 8 hours \* \$50/hour = **\$2800 spent on writing applications**
  - Seems high? Yeah, it seemed high to me too. Some funders (e.g. EA Funds) try to be nice and explicitly say “this should only be a 30min process”
    - But think about incentives: if we apply for a \$100k grant, then a 5% increase in success rate is worth \$5k. So if writing a good grant takes our probability of winning from 20% to 25% (which feels conservative), it’s easily worth at least one person’s entire day to do it.
    - Also: think back to how long you spent on each of your college applications!
- Applying for grants sucks (through no fault of the funders)
  - Takes a long time to hear back
  - You get rejected a lot
  - Wastes time that you could be spending on Actually Doing Things

### Proposal: Create a Common App for EA funding

#### Examples of existing Common Apps

- Common App for undergrads
- Triplebyte for software engineer jobs
- Angellist for startup angel investments
- National Resident Matching Program for med school residents?

#### V0: A new standard

- Two or more grantmaking orgs standardize on a set of questions to ask (eg Google Form). Here are the common questions we’ve seen:
  - Two sentence intro
  - One page project explainer
  - Bios of people running the project
  - How much money do you want
  - What you’ll do with the money
- Opt-in public database where other granters can see proposals (eg Google Spreadsheet)

#### V1: A new website

- Funders can set up profiles, listing:
  - What they’re looking for
  - Funding timelines
  - Decision criteria
- Applicants can submit grant proposals to multiple funders at once
- Grantmaking orgs can browse through public proposals on an ongoing basis

#### V2: And beyond

- The platform could allow funders to coordinate on particular projects
  - Share vetting notes and decisions
  - Split up what portion of funding gap to fill
- Grant proposals could be opened to the public ala Kickstarter?
- [Quadratic funding](https://vitalik.ca/general/2019/12/07/quadratic.html) could be used to (see [Gitcoin Grants](https://gitcoin.co/grants/))

#### Problems a Common App could solve

- Applicants save time applying to different funds
- Applicants can discover more funding sources
  - Navigating EA funding has been tricky, e.g. we thought Manifold (not being a 501c3) was ineligible for SFF, until Nuno mentioned Rethink Charity. And I’m fairly deep into EA!
- Funders can see more project applications
- New funders like Scott can get started without needing to invent infrastructure from whole cloth
- Funders can see who else is funding and adjust accordingly, reducing over & underfunding

#### Cost effectiveness estimate

*warning, here be dragons*

There were 656 applicants to the first round of ACX grants.

- If 10% of those continue on to apply to EA Funds,
- and 10% apply to the FTX EA Fellowship,
- and a common application saves 1 hour per additional application
- that’s 130 hours saved, or about 3 weeks of full-time work

3 weeks of full-time work is also my rough estimate of how long V0 and V1 would take to build out; so after a single grant round, the Common App would pay for itself. ACX and FTX have both indicated interest in future rounds, and EA Funds presumably will be open for a long time.

(This calculation doesn’t include funder time saved, or the positive externality of more/better proposals being funded through a standardized system. You may also want to discount for a less than 100% chance of success, and the opportunity cost for an engineer-hour vs the average applicant-hour.)

#### Caveats

- Funders may have specific criteria they’re looking to fund
  - But just like the college Common App, funders can add supplementary questions, essays, or interviews
- Increasing the total number of applicants could increase filtering load on funders
  - Solution: funders with too much work add more essays, or delist themselves
- Big chunk of value of winning a grant is in the prestige of winning
  - But individual funders can still publicize the grants they chose to distribute
- Another chunk of grant value is in the network of other winners
  - Again, funders can still do this
- Getting any marketplace/network off the ground is hard (aka cost of convincing funders to get on board)
  - E.g. Would Tyler Cowen want to run Emergent Ventures through this common app?
  - Don’t think this is a huge issue; a common app is already usable if any single funder uses it, and valuable once 2+ funders do
    - Also, the common app could branch out of EA, and work for charities in general (and hopefully draw in more people towards EA causes)
- Opportunity cost of building this out
  - 2-4 weeks of 1 full-time engineer
- A new common app might compete for funding mindshare

  ![](https://imgs.xkcd.com/comics/standards.png "500x283")
- Maybe this is what EA Funds already is?
- Unknown unknowns: maybe I don’t understand the funding space
  - Haven’t done much grantmaking myself; would love to chat with grantmaking orgs!
  - Maybe grantmakers already have too many applications to review
  - Maybe most grant applicants only fit for one or two categories, and have an easy time discovering those

#### Who should implement this?

- EA Funds, probably
  - ACX Grants already runs through EA Funds infrastructure
- Lightcone/LessWrong team, maybe
- Manifold could build this as a side project... if somebody wants to fund us to do it 😉
