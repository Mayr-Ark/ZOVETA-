export const CREDITS_PER_REPLY = 4;
export const OVERAGE_RATE = 0.05;
export const LIMIT_REPLY = "You've reached your monthly limit — a team member will follow up soon.";

export const PLANS = Object.freeze({
  free: Object.freeze({ credits: 1000, retention_limit: 20, overage_credits: 0 }),
  starter: Object.freeze({ credits: 3500 * CREDITS_PER_REPLY, retention_limit: 50, overage_credits: Math.ceil(3500 * OVERAGE_RATE) * CREDITS_PER_REPLY }),
  basic: Object.freeze({ credits: 8000 * CREDITS_PER_REPLY, retention_limit: 50, overage_credits: Math.ceil(8000 * OVERAGE_RATE) * CREDITS_PER_REPLY }),
  pro: Object.freeze({ credits: 20000 * CREDITS_PER_REPLY, retention_limit: 50, overage_credits: Math.ceil(20000 * OVERAGE_RATE) * CREDITS_PER_REPLY }),
});

export function getPlan(plan = "free") {
  return PLANS[plan] ?? PLANS.free;
}

export function retentionLimit(plan) {
  return getPlan(plan).retention_limit;
}

export function canReply(tenant) {
  const plan = getPlan(tenant.plan);
  return Number(tenant.credits ?? 0) > -plan.overage_credits;
}
