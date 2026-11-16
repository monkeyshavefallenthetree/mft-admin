export type MilestoneStatus =
  | "Done"
  | "In progress"
  | "Waiting Client"
  | "Pending"
  | "Delayed";

export type PublishStatus =
  | "Draft"
  | "Ready for Review"
  | "Approved"
  | "Revision Requested"
  | "Scheduled"
  | "Published";

export interface RolloutCycleItem {
  id: string;
  name: string; // e.g. "Cycle 01"
  startDate: string; // e.g. "15 Nov 2026"
  endDate: string; // e.g. "10 Dec 2026"
  feedPostsTarget: number; // e.g. 12
  storiesTarget: number; // e.g. 30
}

export interface ScopeRuleItem {
  id: string;
  category: string; // e.g. "Meta", "Production", "Approvals", "Delays", "Publishing", "Paid media", "Working days"
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
}

export interface SignOffCheckItem {
  id: string;
  textEn: string;
  textAr: string;
  confirmed: boolean;
  confirmedAt?: string;
  confirmedBy?: string;
}

export interface MilestoneItem {
  id: string;
  cycle: string; // "Cycle 01" | "Cycle 02" | "Cycle 03"
  monthHeader?: string; // e.g. "December 2026"
  milestone: string;
  owner: "Agency" | "ARC" | "Media Buyer" | "ARC + Agency" | string;
  startDate: string;
  endDate: string;
  actualDate: string;
  status: MilestoneStatus;
  linkEvidence: string;
  notes: string;
  clientApproved?: boolean;
  clientApprovedAt?: string;
  clientComment?: string;
}

export interface FeedPostItem {
  id: string;
  cycle: string; // "Cycle 01" | "Cycle 02" | "Cycle 03"
  contentName: string; // "Post 1" .. "Post 12"
  publishDate: string; // "15 Nov 2026"
  day: string; // "Sun" | "Tue" | "Thu"
  cairoTime: string; // "7:00 PM"
  format: "Reel" | "Post" | "Carousel" | "Video";
  platforms: string; // "FB + IG"
  actualPublish: string;
  postType: "Organic" | "Paid Ad" | "Boosted";
  publishStatus: PublishStatus;
  topicTitle?: string;
  captionText?: string;
  assetLink?: string;
  previewMediaUrl?: string;
  livePostUrl?: string;
  clientComment?: string;
  clientApprovedAt?: string;
}

export interface DailyStoryItem {
  id: string;
  cycle: string; // "Cycle 01" | "Cycle 02" | "Cycle 03"
  storyId: string; // "Story 1" .. "Story 28"
  publishDate: string; // "15 Nov 2026"
  day: string; // "Sun" .. "Sat"
  cairoTime: string; // "6:00 PM"
  platforms: string; // "FB + IG"
  topicAssetLink: string;
  actualPublish: string;
  publishStatus: PublishStatus;
  clientComment?: string;
  clientApprovedAt?: string;
}

export interface PaidMediaCampaignItem {
  id: string;
  cycle: string;
  campaignName: string;
  objective: string;
  budgetEgp: number;
  platforms: string;
  creativeLink: string;
  adAccountAccessConfirmed: boolean;
  status: "Draft" | "Waiting Approval" | "Approved" | "Active" | "Completed";
  reportLink?: string;
  notes?: string;
  clientApprovedAt?: string;
}

export interface ClientPortalInteraction {
  id: string;
  portalId: string;
  actorRole: "client" | "agency";
  actorName: string;
  actionType:
    | "approve_milestone"
    | "submit_assets"
    | "approve_post"
    | "revision_post"
    | "approve_cycle_feed"
    | "approve_story"
    | "revision_story"
    | "approve_ad_campaign"
    | "sign_contract"
    | "comment";
  targetId?: string;
  targetLabel?: string;
  statusAfter?: string;
  linkUrl?: string;
  comment?: string;
  extraData?: Record<string, string | boolean>;
  createdAtIso: string;
}

export interface ClientRolloutPortal {
  id: string; // e.g. "arc"
  clientCode: string; // e.g. "ARC"
  accessPin: string; // e.g. "2026"
  clientName: string; // e.g. "ARC"
  projectTitle: string; // e.g. "ARC | 3-Month Social Media Rollout"
  subtitle: string;
  timezoneLabel: string; // "All times are Cairo local time"
  googleSheetUrl?: string;
  accountManagerName?: string;
  accountManagerWhatsapp?: string;
  clientAssetContactName?: string;
  clientAssetContactPhone?: string;
  clientApproverName?: string;
  clientApproverTitle?: string;
  contractSigned?: boolean;
  contractSignedAt?: string;
  contractSignedBy?: string;
  cycles: RolloutCycleItem[];
  scopeRules: ScopeRuleItem[];
  signOffChecklist: SignOffCheckItem[];
  milestones: MilestoneItem[];
  feedCalendar: FeedPostItem[];
  dailyStories: DailyStoryItem[];
  paidCampaigns: PaidMediaCampaignItem[];
  updatedAtIso: string;
  updatedBy?: string;
}

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatSheetDate(d: Date): { dateStr: string; dayStr: string } {
  const dayNum = String(d.getDate()).padStart(2, "0");
  const mon = MONTHS_SHORT[d.getMonth()] || "Jan";
  const yr = d.getFullYear();
  const wk = DAYS_SHORT[d.getDay()] || "Sun";
  return { dateStr: `${dayNum} ${mon} ${yr}`, dayStr: wk };
}

function buildDailyStoriesFromSheet(): DailyStoryItem[] {
  const ranges: Array<{ cycle: string; startYmd: string; count: number }> = [
    { cycle: "Cycle 01", startYmd: "2026-11-15", count: 28 },
    { cycle: "Cycle 02", startYmd: "2026-12-13", count: 28 },
    { cycle: "Cycle 03", startYmd: "2027-01-10", count: 28 },
  ];
  const list: DailyStoryItem[] = [];
  for (const r of ranges) {
    const base = new Date(`${r.startYmd}T12:00:00`);
    for (let i = 0; i < r.count; i++) {
      const cur = new Date(base);
      cur.setDate(base.getDate() + i);
      const { dateStr, dayStr } = formatSheetDate(cur);
      const cNum = r.cycle.replace(/\D/g, "");
      list.push({
        id: `story_${cNum}_${i + 1}`,
        cycle: r.cycle,
        storyId: `Story ${i + 1}`,
        publishDate: dateStr,
        day: dayStr,
        cairoTime: "6:00 PM",
        platforms: "FB + IG",
        topicAssetLink: "",
        actualPublish: "",
        publishStatus: "Draft",
      });
    }
  }
  return list;
}

export const ARC_DEFAULT_PORTAL: ClientRolloutPortal = {
  id: "arc",
  clientCode: "ARC",
  accessPin: "2026",
  clientName: "ARC",
  projectTitle: "ARC  /  Social Media Rollout",
  subtitle: "Three-month production and publishing plan  •  Draft for review  •  All times are Cairo local time",
  timezoneLabel: "Cairo Local Time (GMT+2)",
  googleSheetUrl:
    "https://docs.google.com/spreadsheets/d/1I3JncSLblk5Dj_9pLRsActJ63BBH9Lg-u-4a9pfAcyA/edit?gid=2114683011#gid=2114683011",
  accountManagerName: "MFT Account Management Team",
  accountManagerWhatsapp: "",
  clientAssetContactName: "",
  clientAssetContactPhone: "",
  clientApproverName: "",
  clientApproverTitle: "",
  contractSigned: false,
  cycles: [
    {
      id: "cycle_01",
      name: "Cycle 01",
      startDate: "15 Nov 2026",
      endDate: "10 Dec 2026",
      feedPostsTarget: 12,
      storiesTarget: 30,
    },
    {
      id: "cycle_02",
      name: "Cycle 02",
      startDate: "13 Dec 2026",
      endDate: "10 Jan 2027",
      feedPostsTarget: 12,
      storiesTarget: 30,
    },
    {
      id: "cycle_03",
      name: "Cycle 03",
      startDate: "10 Jan 2027",
      endDate: "04 Feb 2027",
      feedPostsTarget: 12,
      storiesTarget: 30,
    },
  ],
  scopeRules: [
    {
      id: "rule_meta",
      category: "Meta",
      titleAr: "منصات النشر (Meta)",
      descriptionEn: "The same feed content runs on Facebook and Instagram. Daily Stories are separate from the feed totals.",
      descriptionAr: "يُعرض نفس محتوى الـ Feed على فيسبوك وإنستجرام. الـ Stories اليومية منفصلة تماماً عن إجمالي بوستات الـ Feed.",
    },
    {
      id: "rule_production",
      category: "Production",
      titleAr: "الإنتاج والخامات",
      descriptionEn: "The agency uses ARC’s project assets once the concept and references are approved. Agency shoots are outside the scope.",
      descriptionAr: "تستخدم الوكالة خامات ومشاريع ARC بمجرد اعتماد الـ Concept والـ References. جلسات التصوير الخارجية خارج نطاق هذا التعاقد.",
    },
    {
      id: "rule_approvals",
      category: "Approvals",
      titleAr: "الاعتمادات والموافقات",
      descriptionEn: "ARC approves the references on WhatsApp and approves the calendar on delivery day, seven calendar days after asset handover. Log approval dates and links in Master Timeline.",
      descriptionAr: "تعتمد ARC الـ References عبر واتساب أو البوابة مباشرة، وتعتمد الكالندر في يوم التسليم (بعد ٧ أيام تقويمية من تسليم الخامات).",
    },
    {
      id: "rule_delays",
      category: "Delays",
      titleAr: "التأخيرات وتحديث المواعيد",
      descriptionEn: "The agency follows up on WhatsApp. Publishing stays on hold until ARC approves. Both parties agree on any revised dates.",
      descriptionAr: "تتابع الوكالة على واتساب، ويتوقف النشر مؤقتاً حتى اعتماد ARC، مع اتفاق الطرفين على أي مواعيد معدلة.",
    },
    {
      id: "rule_publishing",
      category: "Publishing",
      titleAr: "مواعيد النشر",
      descriptionEn: "Feed posts go live every Sunday, Tuesday, and Thursday, with 12 posts in a full four-week block. Stories run daily, including weekends.",
      descriptionAr: "تُنشر بوستات الـ Feed أيام الأحد والثلاثاء والخميس (١٢ بوست لكل دورة ٤ أسابيع). الـ Stories تُنشر يومياً شاملة عطلة نهاية الأسبوع.",
    },
    {
      id: "rule_paid_media",
      category: "Paid media",
      titleAr: "الإعلانات الممولة (Paid Media)",
      descriptionEn: "The agency manages Meta ads. Launch requires approval of the objective, budget, and creative, plus confirmed ad account access.",
      descriptionAr: "تدير الوكالة إعلانات Meta، ويتطلب الإطلاق اعتماد الهدف الإعلاني والميزانية والتصميم مع تأكيد صلاحية الحساب الإعلاني.",
    },
    {
      id: "rule_working_days",
      category: "Working days",
      titleAr: "أيام العمل الرسمية",
      descriptionEn: "Sunday through Thursday. Friday and Saturday are days off. Confirm any additional closures with the agency.",
      descriptionAr: "من الأحد إلى الخميس (الجمعة والسبت إجازة أسبوعية). يتم تنسيق أي إجازات إضافية مسبقاً مع الوكالة.",
    },
  ],
  signOffChecklist: [
    {
      id: "chk_1",
      textEn: "Confirm the kickoff, first publish date, and asset deadlines for each cycle. Name ARC’s asset contact and approver.",
      textAr: "تأكيد موعد الانطلاق، وتاريخ أول نشر، ومواعيد تسليم الخامات لكل دورة، وتسمية مسؤول الخامات ومسؤول الاعتماد من طرف ARC.",
      confirmed: false,
    },
    {
      id: "chk_2",
      textEn: "Confirm the mix of Reels and feed posts, publishing times, and that daily Stories include days off and are separate from the 12 feed pieces.",
      textAr: "تأكيد توزيع الـ Reels والبوستات ومواعيد النشر، وأن الـ Stories اليومية تشمل أيام الإجازات ومنفصلة عن الـ ١٢ بوست.",
      confirmed: false,
    },
    {
      id: "chk_3",
      textEn: "Confirm revision rounds, turnaround times, and any extra closures. Record agreed dates and log later changes in Notes.",
      textAr: "تأكيد جولات التعديلات ومدة التنفيذ وأي إغلاقات إضافية، وتسجيل المواعيد المتفق عليها وأي تغييرات لاحقة في الملاحظات.",
      confirmed: false,
    },
  ],
  milestones: [
    // Cycle 01
    {
      id: "ms_c1_1",
      cycle: "Cycle 01",
      milestone: "Concept & References",
      owner: "Agency",
      startDate: "29 Oct 2026",
      endDate: "01 Nov 2026",
      actualDate: "01 Nov 2026",
      status: "Done",
      linkEvidence: "",
      notes: "تجهيز الـConcept والـReferences وقائمة الخامات المطلوبة لكل فكرة وإرسالهم للعميل.",
      clientApproved: true,
    },
    {
      id: "ms_c1_2",
      cycle: "Cycle 01",
      milestone: "References Approval",
      owner: "ARC",
      startDate: "01 Nov 2026",
      endDate: "03 Nov 2026",
      actualDate: "03 Nov 2026",
      status: "Done",
      linkEvidence: "",
      notes: "اعتماد صريح على واتساب خلال يومي عمل.",
      clientApproved: true,
    },
    {
      id: "ms_c1_3",
      cycle: "Cycle 01",
      milestone: "Project Assets Handover",
      owner: "ARC",
      startDate: "03 Nov 2026",
      endDate: "05 Nov 2026",
      actualDate: "05 Nov 2026",
      status: "Done",
      linkEvidence: "",
      notes: "صور المشاريع المطلوبة حسب الـReferences، وأي فيديوهات متاحة، مع بيانات المشروع المسموح نشرها.",
      clientApproved: true,
    },
    {
      id: "ms_c1_4",
      cycle: "Cycle 01",
      milestone: "Production & Calendar Delivery / stories",
      owner: "Agency",
      startDate: "12 Nov 2026",
      endDate: "12 Nov 2026",
      actualDate: "",
      status: "In progress",
      linkEvidence: "",
      notes: "تسليم الكالندر والمحتوى بعد ٧ أيام تقويمية من استلام خامات المشروع.",
    },
    {
      id: "ms_c1_5",
      cycle: "Cycle 01",
      milestone: "Final Calendar Approval",
      owner: "ARC",
      startDate: "12 Nov 2026",
      endDate: "12 Nov 2026",
      actualDate: "",
      status: "Waiting Client",
      linkEvidence: "",
      notes: "ARC يعتمد الكالندر على واتساب أو من خلال البوابة في نفس يوم التسليم.",
    },
    {
      id: "ms_c1_6",
      cycle: "Cycle 01",
      milestone: "Scheduling",
      owner: "Agency",
      startDate: "15 Nov 2026",
      endDate: "10 Dec 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "جدولة الـFeed والـStories على Meta. جدولة محتوى الجمعة والسبت تتم قبل الإجازة.",
    },
    {
      id: "ms_c1_7",
      cycle: "Cycle 01",
      milestone: "Report",
      owner: "Agency",
      startDate: "19 Nov 2026",
      endDate: "19 Nov 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "تقرير الأداء للإعلانات والسوشيال ميديا للشهر اللي فات.",
    },
    // Cycle 02 — December 2026
    {
      id: "ms_c2_1",
      cycle: "Cycle 02",
      monthHeader: "December 2026",
      milestone: "Concept & References",
      owner: "Agency",
      startDate: "22 Nov 2026",
      endDate: "23 Nov 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "تجهيز الـConcept والـReferences وقائمة الخامات المطلوبة لكل فكرة وإرسالهم للعميل.",
    },
    {
      id: "ms_c2_2",
      cycle: "Cycle 02",
      milestone: "References Approval",
      owner: "ARC",
      startDate: "25 Nov 2026",
      endDate: "27 Nov 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "اعتماد صريح على واتساب أو البوابة خلال يومي عمل.",
    },
    {
      id: "ms_c2_3",
      cycle: "Cycle 02",
      milestone: "Project Assets Handover",
      owner: "ARC",
      startDate: "29 Nov 2026",
      endDate: "29 Nov 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "صور المشاريع المطلوبة حسب الـReferences، وأي فيديوهات متاحة، مع بيانات المشروع المسموح نشرها.",
    },
    {
      id: "ms_c2_4",
      cycle: "Cycle 02",
      milestone: "Calendar Delivery",
      owner: "Agency",
      startDate: "06 Dec 2026",
      endDate: "06 Dec 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "تسليم الكالندر والمحتوى بعد ٧ أيام تقويمية من استلام خامات المشروع.",
    },
    {
      id: "ms_c2_5",
      cycle: "Cycle 02",
      milestone: "Final Calendar Approval",
      owner: "ARC",
      startDate: "06 Dec 2026",
      endDate: "06 Dec 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "ARC يعتمد الكالندر على واتساب أو البوابة في نفس يوم التسليم.",
    },
    {
      id: "ms_c2_6",
      cycle: "Cycle 02",
      milestone: "Scheduling",
      owner: "Agency",
      startDate: "10 Dec 2026",
      endDate: "10 Dec 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "جدولة الـFeed والـStories على Meta. جدولة محتوى الجمعة والسبت تتم قبل الإجازة.",
    },
    {
      id: "ms_c2_7",
      cycle: "Cycle 02",
      milestone: "Organic Cycle Start",
      owner: "Agency",
      startDate: "13 Dec 2026",
      endDate: "07 Jan 2027",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "بداية الدورة حسب Feed Calendar وDaily Stories. سجّل أول نشر فعلي هنا وفي التقويم.",
    },
    {
      id: "ms_c2_8",
      cycle: "Cycle 02",
      milestone: "Report",
      owner: "Media Buyer",
      startDate: "20 Dec 2026",
      endDate: "20 Dec 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "تقرير الأداء للإعلانات والسوشيال ميديا.",
    },
    // Cycle 03 — January 2027
    {
      id: "ms_c3_1",
      cycle: "Cycle 03",
      monthHeader: "January 2027",
      milestone: "Concept & References",
      owner: "Agency",
      startDate: "23 Dec 2026",
      endDate: "24 Dec 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "تجهيز الـConcept والـReferences وقائمة الخامات المطلوبة لكل فكرة وإرسالهم للعميل.",
    },
    {
      id: "ms_c3_2",
      cycle: "Cycle 03",
      milestone: "References Approval",
      owner: "ARC",
      startDate: "27 Dec 2026",
      endDate: "28 Dec 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "اعتماد صريح على واتساب أو البوابة خلال يومي عمل.",
    },
    {
      id: "ms_c3_3",
      cycle: "Cycle 03",
      milestone: "Project Assets Handover",
      owner: "ARC",
      startDate: "29 Dec 2026",
      endDate: "30 Dec 2026",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "صور المشاريع المطلوبة حسب الـReferences، وأي فيديوهات متاحة، مع بيانات المشروع المسموح نشرها.",
    },
    {
      id: "ms_c3_4",
      cycle: "Cycle 03",
      milestone: "Calendar Delivery",
      owner: "Agency",
      startDate: "06 Jan 2027",
      endDate: "06 Jan 2027",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "تسليم الكالندر والمحتوى بعد ٧ أيام تقويمية من استلام خامات المشروع.",
    },
    {
      id: "ms_c3_5",
      cycle: "Cycle 03",
      milestone: "Final Calendar Approval",
      owner: "ARC",
      startDate: "06 Jan 2027",
      endDate: "06 Jan 2027",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "ARC يعتمد الكالندر على واتساب أو البوابة في نفس يوم التسليم.",
    },
    {
      id: "ms_c3_6",
      cycle: "Cycle 03",
      milestone: "Scheduling",
      owner: "Agency",
      startDate: "10 Jan 2027",
      endDate: "10 Jan 2027",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "جدولة الـFeed والـStories على Meta. جدولة محتوى الجمعة والسبت تتم قبل الإجازة.",
    },
    {
      id: "ms_c3_7",
      cycle: "Cycle 03",
      milestone: "Organic Cycle Start",
      owner: "Agency",
      startDate: "10 Jan 2027",
      endDate: "04 Feb 2027",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "بداية الدورة حسب Feed Calendar وDaily Stories. سجّل أول نشر فعلي هنا وفي التقويم.",
    },
    {
      id: "ms_c3_8",
      cycle: "Cycle 03",
      milestone: "Report",
      owner: "ARC + Agency",
      startDate: "17 Jan 2027",
      endDate: "17 Jan 2027",
      actualDate: "",
      status: "Pending",
      linkEvidence: "",
      notes: "تقرير الأداء للإعلانات والسوشيال ميديا.",
    },
  ],
  feedCalendar: [
    // Cycle 01
    { id: "fp_c1_1", cycle: "Cycle 01", contentName: "Post 1", publishDate: "15 Nov 2026", day: "Sun", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Ready for Review" },
    { id: "fp_c1_2", cycle: "Cycle 01", contentName: "Post 2", publishDate: "17 Nov 2026", day: "Tue", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Ready for Review" },
    { id: "fp_c1_3", cycle: "Cycle 01", contentName: "Post 3", publishDate: "19 Nov 2026", day: "Thu", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Ready for Review" },
    { id: "fp_c1_4", cycle: "Cycle 01", contentName: "Post 4", publishDate: "22 Nov 2026", day: "Sun", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c1_5", cycle: "Cycle 01", contentName: "Post 5", publishDate: "24 Nov 2026", day: "Tue", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c1_6", cycle: "Cycle 01", contentName: "Post 6", publishDate: "26 Nov 2026", day: "Thu", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c1_7", cycle: "Cycle 01", contentName: "Post 7", publishDate: "29 Nov 2026", day: "Sun", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c1_8", cycle: "Cycle 01", contentName: "Post 8", publishDate: "01 Dec 2026", day: "Tue", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c1_9", cycle: "Cycle 01", contentName: "Post 9", publishDate: "03 Dec 2026", day: "Thu", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c1_10", cycle: "Cycle 01", contentName: "Post 10", publishDate: "06 Dec 2026", day: "Sun", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c1_11", cycle: "Cycle 01", contentName: "Post 11", publishDate: "08 Dec 2026", day: "Tue", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c1_12", cycle: "Cycle 01", contentName: "Post 12", publishDate: "10 Dec 2026", day: "Thu", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    // Cycle 02 — December 2026
    { id: "fp_c2_1", cycle: "Cycle 02", contentName: "Post 1", publishDate: "13 Dec 2026", day: "Sun", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_2", cycle: "Cycle 02", contentName: "Post 2", publishDate: "15 Dec 2026", day: "Tue", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_3", cycle: "Cycle 02", contentName: "Post 3", publishDate: "17 Dec 2026", day: "Thu", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_4", cycle: "Cycle 02", contentName: "Post 4", publishDate: "20 Dec 2026", day: "Sun", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_5", cycle: "Cycle 02", contentName: "Post 5", publishDate: "22 Dec 2026", day: "Tue", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_6", cycle: "Cycle 02", contentName: "Post 6", publishDate: "24 Dec 2026", day: "Thu", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_7", cycle: "Cycle 02", contentName: "Post 7", publishDate: "27 Dec 2026", day: "Sun", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_8", cycle: "Cycle 02", contentName: "Post 8", publishDate: "29 Dec 2026", day: "Tue", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_9", cycle: "Cycle 02", contentName: "Post 9", publishDate: "31 Dec 2026", day: "Thu", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_10", cycle: "Cycle 02", contentName: "Post 10", publishDate: "03 Jan 2027", day: "Sun", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_11", cycle: "Cycle 02", contentName: "Post 11", publishDate: "05 Jan 2027", day: "Tue", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c2_12", cycle: "Cycle 02", contentName: "Post 12", publishDate: "07 Jan 2027", day: "Thu", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    // Cycle 03 — January 2027
    { id: "fp_c3_1", cycle: "Cycle 03", contentName: "Post 1", publishDate: "10 Jan 2027", day: "Sun", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_2", cycle: "Cycle 03", contentName: "Post 2", publishDate: "12 Jan 2027", day: "Tue", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_3", cycle: "Cycle 03", contentName: "Post 3", publishDate: "14 Jan 2027", day: "Thu", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_4", cycle: "Cycle 03", contentName: "Post 4", publishDate: "17 Jan 2027", day: "Sun", cairoTime: "7:00 PM", format: "Reel", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_5", cycle: "Cycle 03", contentName: "Post 5", publishDate: "19 Jan 2027", day: "Tue", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_6", cycle: "Cycle 03", contentName: "Post 6", publishDate: "21 Jan 2027", day: "Thu", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_7", cycle: "Cycle 03", contentName: "Post 7", publishDate: "24 Jan 2027", day: "Sun", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_8", cycle: "Cycle 03", contentName: "Post 8", publishDate: "26 Jan 2027", day: "Tue", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_9", cycle: "Cycle 03", contentName: "Post 9", publishDate: "28 Jan 2027", day: "Thu", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_10", cycle: "Cycle 03", contentName: "Post 10", publishDate: "31 Jan 2027", day: "Sun", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_11", cycle: "Cycle 03", contentName: "Post 11", publishDate: "02 Feb 2027", day: "Tue", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
    { id: "fp_c3_12", cycle: "Cycle 03", contentName: "Post 12", publishDate: "04 Feb 2027", day: "Thu", cairoTime: "7:00 PM", format: "Post", platforms: "FB + IG", actualPublish: "", postType: "Organic", publishStatus: "Draft" },
  ],
  dailyStories: buildDailyStoriesFromSheet(),
  paidCampaigns: [
    {
      id: "paid_c1_1",
      cycle: "Cycle 01",
      campaignName: "ARC Brand Awareness & Flagship Projects Launch",
      objective: "Engagement & Lead Generation (Meta Ads)",
      budgetEgp: 25000,
      platforms: "Facebook + Instagram",
      creativeLink: "",
      adAccountAccessConfirmed: true,
      status: "Waiting Approval",
      reportLink: "",
      notes: "Launch requires approval of the objective, budget, and creative, plus confirmed ad account access.",
    },
    {
      id: "paid_c2_1",
      cycle: "Cycle 02",
      campaignName: "December Retargeting & High-Intent Inquiries",
      objective: "Messages / Leads (Meta Ads)",
      budgetEgp: 30000,
      platforms: "Facebook + Instagram",
      creativeLink: "",
      adAccountAccessConfirmed: true,
      status: "Draft",
      reportLink: "",
      notes: "December 2026 Paid Media Cycle.",
    },
    {
      id: "paid_c3_1",
      cycle: "Cycle 03",
      campaignName: "Q1 2027 Portfolio & Conversion Push",
      objective: "Conversion & Video Views (Meta Ads)",
      budgetEgp: 30000,
      platforms: "Facebook + Instagram",
      creativeLink: "",
      adAccountAccessConfirmed: true,
      status: "Draft",
      reportLink: "",
      notes: "January 2027 Paid Media Cycle.",
    },
  ],
  updatedAtIso: new Date().toISOString(),
  updatedBy: "system_seed",
};
