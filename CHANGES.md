# Backend changes

- Added plan and credit policy constants: 4 credits per reply; free 1,000 credits; starter 14,000 credits; basic 32,000 credits.
- Added a 5% paid-plan overage buffer (175 starter replies / 400 basic replies) and the required soft monthly-limit reply. Free has no overage.
- Added atomic database credit consumption through `consume_tenant_credits` to avoid concurrent overspending.
- Replaced fixed history retention with 20 messages for free and 50 for paid plans.
- Added admin APIs for credit balance, plan switching, free-plan PAYG top-ups, contacts, exclusions, conversations, and retained message history.
- Plan switching resets credits to the target plan grant, as requested.
- PAYG accepts positive multiples of 50 credits because the locked purchase unit is 50 credits for ₦100. Pricing collection/payment processing itself is intentionally outside this backend API.
- Added idempotent exclusion set replacement and single-JID removal. Excluded WhatsApp contacts are ignored before entering the reply pipeline.
- Replaced arbitrary knowledge sources with the five categories: `business`, `faq`, `policy`, `products`, and `orders`. Existing `source` is retained for schema compatibility and is populated with the category.
- Added a thin channel adapter interface. Baileys now extracts WhatsApp-specific data and invokes a channel-neutral incoming-message handler; future adapters only need to provide normalized message/contact data and `sendText`.
- Strengthened the system prompt to enforce business-only discussion, payment refusal/redirection, first-reply greetings, customer first-name addressing, and strict KB grounding.
- Added post-processing for first-reply greetings and payment attempts without matching KB context.
- Customer first names are taken from WhatsApp `pushName`; API test replies can pass `customer_name`. When unavailable or numeric, replies gracefully omit the name.
- Contact names fall back to the JID local part because the original schema has no contacts/profile table. No extra schema beyond the requested migration was introduced.
- Added/updated tests for prompt rules, channel abstraction, plan grants, retention, and overage behavior.
