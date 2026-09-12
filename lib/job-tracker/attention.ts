import { lowerTerm, type Terminology } from "@/lib/job-tracker/config";
import type { BusinessFollowupSettings, Job, JobActivity, Quote, QuoteMessage } from "@/lib/job-tracker/types";

export type AttentionSeverity = "high" | "warning" | "info";
export type AttentionIssueType =
  | "customer_question"
  | "follow_up_due"
  | "follow_up_today"
  | "new_lead"
  | "contacted_follow_up"
  | "proposal_awaiting_response"
  | "stale_opportunity"
  | "unscheduled"
  | "scheduled_no_date"
  | "missing_address";

export type AttentionIssue = {
  action: string;
  age: string;
  id: string;
  job: Job;
  priority: number;
  problem: string;
  quoteMessage?: QuoteMessage & { job?: Job | null };
  quickAction?: "contacted" | "resolve_quote_message";
  severity: AttentionSeverity;
  sortAt: string;
  type: AttentionIssueType;
  why: string;
};

export function ageLabel(value: string) {
  const ageMs = Date.now() - new Date(value).getTime();
  const days = Math.max(0, Math.floor(ageMs / 86_400_000));

  if (days === 0) {
    return "New today";
  }

  if (days === 1) {
    return "1 day old";
  }

  return `${days} days old`;
}

export function dueLabel(value: string) {
  const diffMs = new Date(value).getTime() - Date.now();
  const absDays = Math.max(0, Math.ceil(Math.abs(diffMs) / 86_400_000));

  if (diffMs < 0) {
    if (absDays <= 1) {
      return "Due today";
    }

    return `${absDays} days overdue`;
  }

  if (absDays <= 1) {
    return "Due soon";
  }

  return `Due in ${absDays} days`;
}

export function daysSince(value: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
}

export function attentionSeverity(priority: number): AttentionSeverity {
  if (priority === 0) {
    return "high";
  }

  if (priority >= 1 && priority <= 3) {
    return "warning";
  }

  return "info";
}

export function attentionLabel(severity: AttentionSeverity) {
  return {
    high: "High",
    info: "Info",
    warning: "Warning",
  }[severity];
}

function issue(input: Omit<AttentionIssue, "severity">): AttentionIssue {
  return {
    ...input,
    severity: attentionSeverity(input.priority),
  };
}

export function buildAttentionIssues(input: {
  activities: JobActivity[];
  followupSettings: Pick<BusinessFollowupSettings, "contacted_followup_days" | "new_lead_followup_hours" | "proposal_followup_days" | "reminders_enabled" | "stale_opportunity_days">;
  jobs: Job[];
  quoteMessages: Array<QuoteMessage & { job?: Job | null }>;
  quotes: Quote[];
  terminology: Terminology;
}): AttentionIssue[] {
  const { activities, followupSettings, jobs, quoteMessages, quotes, terminology } = input;
  const now = Date.now();
  const newLeadMs = followupSettings.new_lead_followup_hours * 3_600_000;
  const contactedMs = followupSettings.contacted_followup_days * 86_400_000;
  const proposalMs = followupSettings.proposal_followup_days * 86_400_000;
  const staleMs = followupSettings.stale_opportunity_days * 86_400_000;
  const soonMs = 7 * 86_400_000;
  const items: AttentionIssue[] = [];
  const customerTerm = lowerTerm(terminology.customer_singular);
  const jobTerm = lowerTerm(terminology.job_singular);
  const quoteTerm = lowerTerm(terminology.quote_singular);
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const latestQuoteByJob = new Map<string, Quote>();
  const latestActivityByJob = new Map<string, JobActivity>();

  quotes.forEach((quote) => {
    const current = latestQuoteByJob.get(quote.job_id);
    if (!current || quote.created_at > current.created_at) {
      latestQuoteByJob.set(quote.job_id, quote);
    }
  });

  activities.forEach((activity) => {
    const current = latestActivityByJob.get(activity.job_id);
    if (!current || activity.created_at > current.created_at) {
      latestActivityByJob.set(activity.job_id, activity);
    }
  });

  const unresolvedByQuote = new Map<string, QuoteMessage & { job?: Job | null }>();
  quoteMessages.forEach((quoteMessage) => {
    if (quoteMessage.source === "customer" && !quoteMessage.resolved_at && !unresolvedByQuote.has(quoteMessage.quote_id)) {
      unresolvedByQuote.set(quoteMessage.quote_id, quoteMessage);
    }
  });

  unresolvedByQuote.forEach((quoteMessage) => {
    const job = quoteMessage.job ?? jobsById.get(quoteMessage.job_id) ?? null;

    if (!job || quoteMessage.resolved_at || job.status === "completed" || job.status === "lost") {
      return;
    }

    items.push(issue({
      action: `Review the question and follow up with the ${customerTerm}.`,
      age: ageLabel(quoteMessage.created_at),
      id: `${quoteMessage.id}-quote-message`,
      job,
      priority: 0,
      problem: `${terminology.customer_singular} has a question about a ${quoteTerm}`,
      quoteMessage,
      quickAction: "resolve_quote_message",
      sortAt: quoteMessage.created_at,
      type: "customer_question",
      why: "Questions can block a proposal decision until the customer hears back.",
    }));
  });

  jobs.forEach((job) => {
    if (job.status === "completed" || job.status === "lost") {
      return;
    }

    const followUpAt = job.next_follow_up_at ? new Date(job.next_follow_up_at).getTime() : null;
    const hasFutureFollowUp = Boolean(followUpAt && followUpAt > now);
    const latestQuote = latestQuoteByJob.get(job.id);
    const quoteIsClosed = latestQuote?.status === "accepted" || latestQuote?.status === "declined";
    const lastSalesActivityAt = latestActivityByJob.get(job.id)?.created_at ?? job.updated_at;
    let hasPrimaryReminder = false;

    if (followupSettings.reminders_enabled && job.next_follow_up_at) {
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      if (followUpAt && followUpAt <= now) {
        hasPrimaryReminder = true;
        items.push(issue({
          action: "Follow up, then set the next follow-up date.",
          age: dueLabel(job.next_follow_up_at),
          id: `${job.id}-follow-up-due`,
          job,
          priority: 0,
          problem: "Follow-up is overdue",
          sortAt: job.next_follow_up_at,
          type: "follow_up_due",
          why: "Overdue follow-ups are the easiest opportunities to lose track of.",
        }));
      } else if (followUpAt && followUpAt <= todayEnd.getTime()) {
        hasPrimaryReminder = true;
        items.push(issue({
          action: "Handle the planned follow-up today or move the date.",
          age: "Due today",
          id: `${job.id}-follow-up-today`,
          job,
          priority: 5,
          problem: "Follow-up is due today",
          sortAt: job.next_follow_up_at,
          type: "follow_up_today",
          why: "A planned follow-up is due before the end of the day.",
        }));
      }
    }

    if (followupSettings.reminders_enabled && !hasPrimaryReminder && !hasFutureFollowUp && job.status === "lead" && !job.first_contact_at && now - new Date(job.created_at).getTime() >= newLeadMs) {
      hasPrimaryReminder = true;
      items.push(issue({
        action: `Contact the ${customerTerm} and mark the lead contacted.`,
        age: ageLabel(job.created_at),
        id: `${job.id}-new-lead`,
        job,
        priority: 1,
        problem: "New lead has not been contacted",
        quickAction: "contacted",
        sortAt: job.created_at,
        type: "new_lead",
        why: "New prospects are most valuable when they get a fast first response.",
      }));
    }

    if (
      followupSettings.reminders_enabled &&
      !hasPrimaryReminder &&
      !hasFutureFollowUp &&
      job.status === "contacted" &&
      job.first_contact_at &&
      !job.quote_sent_at &&
      now - new Date(job.first_contact_at).getTime() >= contactedMs
    ) {
      hasPrimaryReminder = true;
      items.push(issue({
        action: `Follow up with the ${customerTerm} or prepare a ${quoteTerm}.`,
        age: `${daysSince(job.first_contact_at)} days since contact`,
        id: `${job.id}-contacted-follow-up`,
        job,
        priority: 2,
        problem: "Follow-up needed",
        sortAt: job.first_contact_at,
        type: "contacted_follow_up",
        why: "Contacted opportunities need a next step before the conversation goes cold.",
      }));
    }

    if (
      followupSettings.reminders_enabled &&
      !hasPrimaryReminder &&
      !hasFutureFollowUp &&
      job.status === "quoted" &&
      job.quote_sent_at &&
      !quoteIsClosed &&
      now - new Date(job.quote_sent_at).getTime() >= proposalMs
    ) {
      hasPrimaryReminder = true;
      const daysWaiting = daysSince(job.quote_sent_at);
      items.push(issue({
        action: `Check in on the ${quoteTerm} or set a follow-up.`,
        age: `${daysWaiting} days since ${quoteTerm}`,
        id: `${job.id}-proposal-awaiting-response`,
        job,
        priority: daysWaiting >= followupSettings.proposal_followup_days * 2 ? 0 : 2,
        problem: `${terminology.quote_singular} awaiting response`,
        sortAt: job.quote_sent_at,
        type: "proposal_awaiting_response",
        why: `Sent ${lowerTerm(terminology.quote_plural)} need a clear response path or a next follow-up date.`,
      }));
    }

    if (
      followupSettings.reminders_enabled &&
      !hasPrimaryReminder &&
      !hasFutureFollowUp &&
      ["lead", "contacted", "quoted"].includes(job.status) &&
      now - new Date(lastSalesActivityAt).getTime() >= staleMs
    ) {
      hasPrimaryReminder = true;
      items.push(issue({
        action: "Choose the next step or set a follow-up date.",
        age: `${daysSince(lastSalesActivityAt)} days since activity`,
        id: `${job.id}-stale-opportunity`,
        job,
        priority: 2,
        problem: "Opportunity has gone quiet",
        sortAt: lastSalesActivityAt,
        type: "stale_opportunity",
        why: "Quiet opportunities need an explicit next step so they do not linger in the pipeline.",
      }));
    }

    if ((job.status === "contacted" || job.status === "quoted") && !job.scheduled_start && !quoteIsClosed) {
      items.push(issue({
        action: `Schedule the ${jobTerm} or mark it lost.`,
        age: ageLabel(job.created_at),
        id: `${job.id}-unscheduled`,
        job,
        priority: 6,
        problem: "Opportunity is not scheduled",
        sortAt: job.updated_at,
        type: "unscheduled",
        why: "Active opportunities without a confirmed schedule can fall between sales and operations.",
      }));
    }

    if (job.status === "scheduled" && !job.scheduled_start) {
      items.push(issue({
        action: "Add a confirmed start date before treating this as scheduled work.",
        age: ageLabel(job.created_at),
        id: `${job.id}-scheduled-no-date`,
        job,
        priority: 0,
        problem: `Scheduled ${jobTerm} has no start date`,
        sortAt: job.updated_at,
        type: "scheduled_no_date",
        why: "Scheduled work needs a confirmed date before it can reliably appear on the calendar.",
      }));
    }

    if (
      job.status === "scheduled" &&
      job.scheduled_start &&
      new Date(job.scheduled_start).getTime() - now <= soonMs &&
      new Date(job.scheduled_start).getTime() >= now &&
      !job.job_address
    ) {
      items.push(issue({
        action: "Add the service address before the crew heads out.",
        age: dueLabel(job.scheduled_start),
        id: `${job.id}-missing-address`,
        job,
        priority: 3,
        problem: `Upcoming ${jobTerm} is missing an address`,
        sortAt: job.scheduled_start,
        type: "missing_address",
        why: "Upcoming work needs location details before it can be handled cleanly.",
      }));
    }
  });

  return items.sort((a, b) => a.priority - b.priority || a.sortAt.localeCompare(b.sortAt));
}

export function issuesByJobId(issues: AttentionIssue[]) {
  return issues.reduce((map, issue) => {
    const current = map.get(issue.job.id) ?? [];
    current.push(issue);
    map.set(issue.job.id, current);
    return map;
  }, new Map<string, AttentionIssue[]>());
}
