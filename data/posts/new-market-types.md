---
title: "New market types"
date: "2022-05-29"
notion: "0098cc39d6af480b9d72daaf8f3592b3"
url: "https://akrolsmir.notion.site/New-market-types-0098cc39d6af480b9d72daaf8f3592b3"
excerpt: ""
---

A survey of new market types that would allow people to trade on more kinds of information!

### True Numeric Markets

[https://manifold.markets/Austin/will-manifold-change-numeric-market](https://manifold.markets/Austin/will-manifold-change-numeric-market)

Today’s numeric markets are implemented where users can input their guess about the most likely result as a normal distribution around curve. Under the hood, we turn the range between MIN and MAX to 100 buckets using our Dynamic Parimutuel system.

Dynamic Parimutuel has the drawback here of not having a locked in payout. Instead, we can use the YES/NO market type

Use cases:

- “How many \<X\> will there be on \<Y date\>”? E.g. “How many Covid cases by the end of the year?”
  - This is super general! I think many YES/NO markets today would be better framed using a point estimate of what a particular value ought to look like.
- “How many days from market creation until \<X happens\>? E.g. “How many days until a new #1 Billboard song is crowned?”

Drawbacks:

- With only ability to bet on MIN or MAX, you can’t put in arbitrary distributions. This means that you can’t earn as much on an outcome happening as you might, even if you have really precise information.
  - Imagine we’re betting “On what day this year will Alex visit his 10th state \[1-365\]”, with the market predicting 100, but I’m very certain it should be 150. I can bet up the value to 150 and make guaranteed money, but it’s not the most efficient use of capital because I’ve also invested in a payout for when Alex hits that state on day 160 or 365.

### Multi-category CPMM

Today’s markets are all binary, pricing two assets proportional to each other. However, the constant product market maker should work to n=3 or even more assets. For example, you could imagine 4 outcomes for “which multiple choice answer is correct?”, with a formula keeping

A \* B \* C \* D = k

To buy up shares of B, you would take M\$1, create 1 share each of A/B/C/D, and put A/C/D rest into the pool to withdrawal some additional share of B.

Use cases:

- Exclusive situations: “Who will win the Democratic primary?”
- Numeric buckets: “Will there be \[0-5\], \[6-10\], \[11-30\], \[30+\] attendees at this dinner party?”
  - In the limit, as you add more buckets, CPMM may become intractable to compute?
- Conditional prediction markets with efficient capital allocation
- Better Free Response?
  - Dynamically adding new outcomes may be tricky.

### Partially resolved markets

Every YES and NO share is a claim on some portion of M\$1. Today, the creator of the market can decide where to send the M\$1.

- Resolving to YES sends M\$1 to YES holders
- Resolving to NO sends M\$1 to NO holders
- Resolving to PROB at 30% sends M\$0.3 to YES, M\$ 0.7 to NO

For certain kinds of numeric markets, the creator and traders actually know part of how this question will resolve. For example, in a numeric market on “What % of the Manifold team will catch COVID this year?”, once 4 out of 6 members have caught COVID, the question is guaranteed to resolve to at least 66%. Each YES share at this point should be worth \>66%; but the liquidity pool is still holding on to the full M\$1.

With partial resolution, the market creator could decide to pay M\$0.66 immediately to each holder of YES. Afterwards, each YES or NO share can pay out at most M\$0.34.

Use cases:

- Freeing up more capital to traders

[https://manifold.markets/MartinRandall/will-partial-resolution-of-yesno-ma](https://manifold.markets/MartinRandall/will-partial-resolution-of-yesno-ma)

### Bonus: continuously resolved markets

(Is this the same thing as a perpetual swap?)

### Equity

Manifold’s markets today are paired swaps between YES and NO shares. But the same Uniswap mechanism can work for any pair of things. For example, you could swap USD with GOOG (shares of Google), meaning that people wanting to buy GOOG shares can swap in USD to get some, or sell GOOG shares to take out USD.

Actually, you could use YES/NO shares as a formulation of this! You could view a YES share as a bet that 1 GOOG share will be worth \~infinity USD, and NO shares as a bet that \~infinity GOOG shares will be worth 1 USD.

[https://manifold.markets/Austin/will-manifold-implement-retroactive](https://manifold.markets/Austin/will-manifold-implement-retroactive)

### Perpetual Swaps

Allowing people to directly trade GOOG can be tricky, because your system has to enforce actually moving shares of GOOG around. What if you just want to let people bet for or against the value of GOOG, without 

Enter Perpetual Swaps. Using this mechanism, traders can agree to bet on any asset without the underlying asset being locked on the chain!

[https://manifold.markets/Austin/will-manifold-offer-a-perpetual-swa](https://manifold.markets/Austin/will-manifold-offer-a-perpetual-swa)

#### Previous notes

[Untitled](https://app.notion.com/p/36321d16185543ad93d6e9484f8718c4) 

[Untitled](https://app.notion.com/p/8f0c2b7c0ef94173b5729e14b3e2c577) 

[Untitled](https://app.notion.com/p/b53988caf0c44522adebec75add89a35) 

[Untitled](https://app.notion.com/p/caa6ac9c09814b8e8e208dae94cc17c7)
