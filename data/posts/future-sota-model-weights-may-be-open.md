---
title: "Future SOTA model weights may be open"
date: "2024-08-11"
notion: "67682757811a459888d9b5954618b152"
url: "https://akrolsmir.notion.site/Future-SOTA-model-weights-may-be-open-67682757811a459888d9b5954618b152"
excerpt: ""
---

Today, the best LLM models are Claude 3.5 Sonnet, GPT-4o, and Gemini 1.5, which are all closed-weights. The best open model, Llama 3.1, comes in fourth.

However, I suspect closed-weight models may not continue to be state of the art.

#### Why might open model weights win?

- Ecosystem: open ecosystems and platforms win when they can draw upon a wider base of users, developers, and partners to invest into the ecosystem
  - Today, Llama has a stronger finetuning ecosystem than its competitors
  - Tom at Etched (a startup making cheaper ASICs for inference) tells me that their chip design is informed more by Llama architecture than others, because Llama was open
- Ideology: top AI researchers or company leaders may be drawn to open weights for society’s benefit
- Economics: the marginal cost of duplication of model weights is zero, so there’s a economic pressure for companies which can profitably open model weights to do so.
  - See the fall in cost of music as a result of streaming services (though: music is still licensed via copyright)
- Case studies from open source code
  - Code, like model weights, require high upfront costs to produce, but the output has \~0 marginal cost of duplication
  - Linux
  - React
- Pathways to open model weights
  - OpenAI or Anthropic decide that opening the weights help with their mission of safe AGI; or that it’s in their self-interest
    - Not so crazy — this was the original formulation of OpenAI!
  - Meta AI takes the lead, and they uphold their commitments to open weights
    - Also seems reasonable, commitments are meaningful and going back on it would be embarrassing
  - Government funded research initiative (like Leopold’s “the project”) decides its weights should be made public, or the public demands that its weights should be public

#### Why not?

- Economics: It’s very expensive to train SOTA models, and keeping those weights private gives the trainers the ability to monetize
  - Though: for this to hold, one needs to explain why open source exists at all
    - Is there more open source or closed source code in the world? Probably closed source.
    - Is more open source or closed source code run in the world? mu.
- Ecosystem: In LLM applications (eg Cursor) it’s pretty easy to switch out one API provider for another, meaning that applications themselves don’t care too much whether the model is open or not
  - So an alternative loop: apps will choose whichever model is SOTA, SOTA models can take those customer dollars and invest into larger models (or 
- Case studies from non-open code:
  - Google
  - Facebook
  - Reddit
- Case studies from generative AI:
  - After a brief flourishing ecosystem, Stable Diffusion (the company) seems to have imploded

#### What would open model weights imply?

- Model weight security is not worth investing in
- Does more or less value accrue to:
  - Chipmakers like Nvidia
  - Cloud hyperscalers like AWS/Google/Microsoft
  - Application developers?

#### More reading

- [https://about.fb.com/news/2024/07/open-source-ai-is-the-path-forward/](https://about.fb.com/news/2024/07/open-source-ai-is-the-path-forward/)
- [https://openai.com/global-affairs/openai-s-comment-to-the-ntia-on-open-model-weights/](https://openai.com/global-affairs/openai-s-comment-to-the-ntia-on-open-model-weights/)
- [https://www.etched.com/announcing-etched](https://www.etched.com/announcing-etched)
