/**
 * Official Company Disciplinary & Penalties Schedule (لائحة الجزاءات والمخالفات التأديبية)
 * Structured into 3 main categories with progressive 4-tier penalties (1st, 2nd, 3rd, 4th offense)
 * and automatic daily-wage deduction calculation for Payroll integration.
 */

export type ViolationCategory = "attendance" | "operations" | "conduct";

export type OffenseTier = 1 | 2 | 3 | 4;

export interface TierPenaltySpec {
  /** Arabic display label exactly as in the official schedule (e.g. "ربع يوم", "نصف يوم", "يوم", "يومان", "إنذار", "انهاء التعاقد") */
  labelAr: string;
  /** English display label */
  labelEn: string;
  /** Number of salary days to deduct automatically from payroll (0 for warning, 0.25, 0.5, 1, 2, 3, 4, 5) */
  deductionDays: number;
  /** Severity badge tone */
  severity: "warning" | "deduction" | "increment_penalty" | "termination" | "none";
}

export interface DisciplinaryViolationRule {
  /** Official rule number in the schedule (e.g. 1, 2, 3, 4, ..., 58) */
  code: number;
  /** Category of the violation */
  category: ViolationCategory;
  /** Full Arabic title of the violation */
  titleAr: string;
  /** English summary title */
  titleEn: string;
  /** 1st, 2nd, 3rd, 4th time penalties */
  tiers: {
    1: TierPenaltySpec;
    2: TierPenaltySpec;
    3: TierPenaltySpec;
    4: TierPenaltySpec;
  };
  /** Official notes / extra legal effects (ملاحظات) */
  notesAr?: string;
  notesEn?: string;
  /** Whether the unpaid absence/late time itself is also deducted in addition to the penalty */
  deductUnworkedTime?: boolean;
}

export const VIOLATION_CATEGORIES: Record<
  ViolationCategory,
  { titleAr: string; titleEn: string; subtitleAr: string; icon: string; badgeCls: string }
> = {
  attendance: {
    titleAr: "أولاً — مخالفات تتعلق بمواعيد العمل",
    titleEn: "1. Working Hours & Attendance Violations",
    subtitleAr: "التأخير، الانقطاع بدون إذن، عدم التوقيع، التلاعب في إثبات الحضور، والانصراف المبكر",
    icon: "⏰",
    badgeCls: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800",
  },
  operations: {
    titleAr: "ثانياً — مخالفات تتعلق بنظام العمل وممتلكات المنشأة",
    titleEn: "2. Workplace Rules, Operations & Company Property",
    subtitleAr: "تعليمات السلامة، أجهزة وممتلكات المنشأة، تنفيذ الأوامر، الخامات، وأسرار العمل",
    icon: "🏢",
    badgeCls: "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800",
  },
  conduct: {
    titleAr: "ثالثاً — مخالفات تتعلق بالسلوك العام",
    titleEn: "3. Workplace Conduct & Ethics Violations",
    subtitleAr: "الاحترام الواجب، التحقيقات الإدارية، التعامل مع الزملاء والرؤساء، وكرامة الوظيفة",
    icon: "⚖️",
    badgeCls: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800",
  },
};

const d = (
  labelAr: string,
  labelEn: string,
  deductionDays: number,
  severity: TierPenaltySpec["severity"] = deductionDays > 0 ? "deduction" : "warning",
): TierPenaltySpec => ({
  labelAr,
  labelEn,
  deductionDays,
  severity,
});

const sameAllTiers = (spec: TierPenaltySpec) => ({
  1: spec,
  2: spec,
  3: spec,
  4: spec,
});

export const DISCIPLINARY_RULES: DisciplinaryViolationRule[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // أولاً: مخالفات تتعلق بمواعيد العمل
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: 1,
    category: "attendance",
    titleAr: "التأخير عن مواعيد العمل لغاية 60 دقيقة دون إذن أو عذر مقبول",
    titleEn: "Late arrival up to 60 minutes without permission or accepted excuse",
    tiers: {
      1: d("ربع يوم", "0.25 Day", 0.25),
      2: d("ربع يوم", "0.25 Day", 0.25),
      3: d("ربع يوم", "0.25 Day", 0.25),
      4: d("ربع يوم", "0.25 Day", 0.25),
    },
    notesAr: "يقصد بعبارة اليوم أن الجزاء الموقع هو الخصم من الأجر بالمقدار المبين",
    notesEn: "'Day' means salary deduction equal to the specified fraction of daily pay",
  },
  {
    code: 2,
    category: "attendance",
    titleAr: "التأخير عن مواعيد العمل أكثر من 70 دقيقة حتى 90 دقيقة دون إذن أو عذر مقبول",
    titleEn: "Late arrival between 70 and 90 minutes without permission or accepted excuse",
    tiers: {
      1: d("نصف يوم", "0.5 Day", 0.5),
      2: d("نصف يوم", "0.5 Day", 0.5),
      3: d("نصف يوم", "0.5 Day", 0.5),
      4: d("نصف يوم", "0.5 Day", 0.5),
    },
    notesAr: "خصم نصف يوم من الأجر عند تجاوز التأخير 70 دقيقة حتى 90 دقيقة بدون إذن",
  },
  {
    code: 3,
    category: "attendance",
    titleAr:
      "التأخير عن مواعيد العمل أكثر من 120 دقيقة دون إذن أو عذر مقبول سواء ترتب أو لم يترتب على التأخير تعطيل عمال آخرين",
    titleEn: "Late arrival exceeding 120 minutes without permission (treated as unexcused absence)",
    tiers: {
      1: d("يوم (عقوبة الغياب)", "1 Day (Absence Penalty)", 1),
      2: d("يوم (عقوبة الغياب)", "1 Day (Absence Penalty)", 1),
      3: d("يومان (عقوبة الغياب)", "2 Days (Absence Penalty)", 2),
      4: d("يومان (عقوبة الغياب)", "2 Days (Absence Penalty)", 2),
    },
    notesAr: "يمنع العامل من الدخول ويعتبر غياباً وتطبق عليه عقوبة الغياب بدون إذن",
    notesEn: "Worker is denied entry, marked absent, and subject to unexcused absence penalty",
    deductUnworkedTime: true,
  },
  {
    code: 4,
    category: "attendance",
    titleAr: "الانقطاع عن العمل بدون إذن أو عذر مقبول",
    titleEn: "Absence from work without permission or accepted excuse",
    tiers: {
      1: d("يوم", "1 Day", 1),
      2: d("يوم", "1 Day", 1),
      3: d("يومان", "2 Days", 2),
      4: d("يومان", "2 Days", 2),
    },
    notesAr: "مع حرمان العامل من أجر أيام الغياب",
    notesEn: "In addition to forfeiting the unpaid absence day wage",
    deductUnworkedTime: true,
  },
  {
    code: 5,
    category: "attendance",
    titleAr:
      "عدم التوقيع في سجلات الحضور أو الانصراف أو ما يقوم مقامها بما يفيد الوقت الفعلي للحضور أو الانصراف بدون إذن أو عذر مقبول",
    titleEn: "Failure to clock in or clock out in attendance records without permission",
    tiers: sameAllTiers(d("ربع يوم", "0.25 Day", 0.25)),
  },
  {
    code: 6,
    category: "attendance",
    titleAr: "البقاء في مكان العمل بعد انتهائه أو العودة إليه بعد انتهاء مواعيد العمل دون إذن أو عذر مقبول",
    titleEn: "Remaining at or returning to the workplace after shift hours without permission",
    tiers: sameAllTiers(d("ربع يوم", "0.25 Day", 0.25)),
  },
  {
    code: 7,
    category: "attendance",
    titleAr: "التلاعب في طريقة إثبات الحضور أو الانصراف أو كلاهما",
    titleEn: "Tampering with or falsifying clock-in / clock-out attendance verification",
    tiers: {
      1: d("يوم", "1 Day", 1),
      2: d("يومان", "2 Days", 2),
      3: d("ثلاثة أيام", "3 Days", 3),
      4: d("أربعة أيام", "4 Days", 4),
    },
  },
  {
    code: 8,
    category: "attendance",
    titleAr: "ترك مكان العمل أو الانصراف قبل المواعيد المحددة دون إذن أو عذر مقبول",
    titleEn: "Leaving the workplace or clocking out before scheduled end time without permission",
    tiers: sameAllTiers(d("نصف يوم", "0.5 Day", 0.5)),
    notesAr: "مع حرمان العامل من أجر ساعات الغياب",
    notesEn: "In addition to deducting the unworked hours",
    deductUnworkedTime: true,
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ثانياً: مخالفات تتعلق بنظام العمل وممتلكات المنشأة
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: 12,
    category: "operations",
    titleAr: "مخالفة القواعد والتعليمات الصحية المعلقة في أماكن العمل",
    titleEn: "Violating health and safety rules posted in the workplace",
    tiers: {
      1: d("يوم", "1 Day", 1),
      2: d("يومان", "2 Days", 2),
      3: d("ثلاثة أيام", "3 Days", 3),
      4: d("خمسة أيام", "5 Days", 5),
    },
  },
  {
    code: 14,
    category: "operations",
    titleAr: "عدم الإخطار عن تغير الحالة الاجتماعية ومحل الإقامة خلال أسبوع من تاريخ التغير",
    titleEn: "Failure to notify HR of marital status or address change within 1 week",
    tiers: {
      1: d("إنذار", "Written Warning", 0, "warning"),
      2: d("نصف يوم", "0.5 Day", 0.5),
      3: d("يوم", "1 Day", 1),
      4: d("يومان", "2 Days", 2),
    },
  },
  {
    code: 16,
    category: "operations",
    titleAr: "استقبال أشخاص من غير العاملين بالمنشأة في أماكن العمل دون إذن",
    titleEn: "Receiving unauthorized visitors in the workplace without permission",
    tiers: {
      1: d("إنذار", "Written Warning", 0, "warning"),
      2: d("نصف يوم", "0.5 Day", 0.5),
      3: d("يوم", "1 Day", 1),
      4: d("يومان", "2 Days", 2),
    },
  },
  {
    code: 17,
    category: "operations",
    titleAr: "استعمال أجهزة المنشأة لأغراض شخصية بدون إذن",
    titleEn: "Using company equipment or devices for personal purposes without permission",
    tiers: {
      1: d("نصف يوم", "0.5 Day", 0.5),
      2: d("يوم", "1 Day", 1),
      3: d("يومان", "2 Days", 2),
      4: d("يومان", "2 Days", 2),
    },
  },
  {
    code: 19,
    category: "operations",
    titleAr: "نزع أو تمزيق المنشورات أو المطبوعات المتعلقة بدواعي العمل",
    titleEn: "Removing or tearing down official workplace notices or publications",
    tiers: {
      1: d("يومان", "2 Days", 2),
      2: d("ثلاثة أيام", "3 Days", 3),
      3: d("أربعة أيام", "4 Days", 4),
      4: d("خمسة أيام", "5 Days", 5),
    },
  },
  {
    code: 22,
    category: "operations",
    titleAr: "تنظيم الاجتماعات أو المشاركة فيها داخل أماكن العمل دون إذن من الإدارة",
    titleEn: "Organizing or participating in unauthorized meetings inside the workplace",
    tiers: {
      1: d("يوم", "1 Day", 1),
      2: d("ثلاثة أيام", "3 Days", 3),
      3: d("أربعة أيام", "4 Days", 4),
      4: d("خمسة أيام", "5 Days", 5),
    },
  },
  {
    code: 23,
    category: "operations",
    titleAr: "إدخال مشروبات روحية أو أية أشياء غير مصرح بها",
    titleEn: "Bringing alcohol or prohibited items into the workplace",
    tiers: {
      1: d("ثلاثة أيام", "3 Days", 3),
      2: d("خمسة أيام", "5 Days", 5),
      3: d("الفصل بعد العرض على اللجنة الخماسية", "Dismissal via Committee", 5, "termination"),
      4: d("الفصل بعد العرض على اللجنة الخماسية", "Dismissal via Committee", 5, "termination"),
    },
  },
  {
    code: 24,
    category: "operations",
    titleAr: "النوم أثناء العمل",
    titleEn: "Sleeping during working hours",
    tiers: {
      1: d("نصف يوم", "0.5 Day", 0.5),
      2: d("يوم", "1 Day", 1),
      3: d("يومان", "2 Days", 2),
      4: d("ثلاثة أيام", "3 Days", 3),
    },
  },
  {
    code: 25,
    category: "operations",
    titleAr: "التدخين أو إشعال النار في أماكن العمل",
    titleEn: "Smoking or lighting fire in prohibited workplace areas",
    tiers: {
      1: d("إنذار", "Written Warning", 0, "warning"),
      2: d("نصف يوم", "0.5 Day", 0.5),
      3: d("يوم", "1 Day", 1),
      4: d("يومان", "2 Days", 2),
    },
  },
  {
    code: 26,
    category: "operations",
    titleAr: "عدم الحرص على استخدام الخامات أو أدوات العمل أو الإسراف في استهلاكها",
    titleEn: "Carelessness or wastefulness in using company materials or tools",
    tiers: {
      1: d("يومان", "2 Days", 2),
      2: d("يومان", "2 Days", 2),
      3: d("يومان", "2 Days", 2),
      4: d("ثلاثة أيام", "3 Days", 3),
    },
  },
  {
    code: 29,
    category: "operations",
    titleAr:
      "الإهمال في المحافظة على أموال أو ممتلكات المنشأة أو ما يكون مودعاً لديها لحساب عملائها بما قد يعرضها للتلف أو الفقد مما يترتب عليه ضرر للمنشأة",
    titleEn: "Negligence in safeguarding company or client property/funds causing damage or loss",
    tiers: {
      1: d("خمسة أيام", "5 Days", 5),
      2: d("خفض الأجر بمقدار علاوة سنوية", "Salary reduction by annual increment", 5, "increment_penalty"),
      3: d(
        "خفض الوظيفة إلى الدرجة الأدنى مباشرة دون الإخلال بقيمة الأجر",
        "Demotion by one grade without pay reduction",
        5,
        "increment_penalty",
      ),
      4: d("الفصل بعد العرض على اللجنة الخماسية", "Dismissal via Committee", 5, "termination"),
    },
  },
  {
    code: 30,
    category: "operations",
    titleAr: "مخالفة أو عدم تنفيذ الأوامر أو التعليمات الصادرة من الإدارة أو الرؤساء والمتعلقة بالعمل وتنظيمه",
    titleEn: "Disobeying or failing to execute work-related orders from management or supervisors",
    tiers: {
      1: d("يوم", "1 Day", 1),
      2: d("يومان", "2 Days", 2),
      3: d("يومان", "2 Days", 2),
      4: d("ثلاثة أيام", "3 Days", 3),
    },
  },
  {
    code: 31,
    category: "operations",
    titleAr: "التحريض على مخالفة الأوامر والتعليمات الخاصة بالعمل أو على عدم تنفيذها",
    titleEn: "Inciting others to violate or refuse work orders and instructions",
    tiers: {
      1: d("يومان", "2 Days", 2),
      2: d("يومان", "2 Days", 2),
      3: d("يومان", "2 Days", 2),
      4: d("ثلاثة أيام", "3 Days", 3),
    },
  },
  {
    code: 33,
    category: "operations",
    titleAr: "العبث بالأدوات أو الآلات أو المهمات بحسن نية",
    titleEn: "Tampering with tools or equipment in good faith",
    tiers: {
      1: d("إنذار", "Written Warning", 0, "warning"),
      2: d("نصف يوم", "0.5 Day", 0.5),
      3: d("يوم", "1 Day", 1),
      4: d("يومان", "2 Days", 2),
    },
  },
  {
    code: 34,
    category: "operations",
    titleAr:
      "الإهمال في الآلات أو الأدوات أو المعدات أو استخدامها سيئاً أو الاستمرار في تشغيلها رغم وجود خلل بها وعدم التبليغ عن هذا الخلل",
    titleEn: "Negligence or misuse of equipment or continuing operation despite a known fault without reporting",
    tiers: {
      1: d("خمسة أيام", "5 Days", 5),
      2: d("تأجيل موعد استحقاق العلاوة لمدة 3 شهور", "Defer annual increment by 3 months", 5, "increment_penalty"),
      3: d("خفض الأجر بمقدار علاوة", "Reduce pay by increment", 5, "increment_penalty"),
      4: d("الفصل بعد العرض على اللجنة الخماسية", "Dismissal via Committee", 5, "termination"),
    },
  },
  {
    code: 37,
    category: "operations",
    titleAr: "أداء أعمال للغير بأجر أو بغير أجر في أوقات العمل بدون إذن",
    titleEn: "Performing work for third parties (paid or unpaid) during working hours without permission",
    tiers: {
      1: d("يومان", "2 Days", 2),
      2: d("أربعة أيام", "4 Days", 4),
      3: d("خمسة أيام", "5 Days", 5),
      4: d("حرمان من نصف العلاوة", "Forfeit half annual increment", 5, "increment_penalty"),
    },
  },
  {
    code: 38,
    category: "operations",
    titleAr:
      "إفشاء العامل للأمور التي يطلع عليها بحكم وظيفته إذا كانت سرية بطبيعتها أو بموجب تعليمات تقضي بذلك",
    titleEn: "Disclosing confidential company or client information obtained by virtue of employment",
    tiers: sameAllTiers(d("الفصل وإنهاء التعاقد", "Immediate Termination of Contract", 5, "termination")),
    notesAr: "الفصل وإنهاء التعاقد لمخالفة واجب السرية المهنية",
  },
  {
    code: 44,
    category: "operations",
    titleAr: "سوء استعمال الرؤساء للسلطات المخولة لهم",
    titleEn: "Abuse of authority by supervisors or managers",
    tiers: {
      1: d("نصف يوم", "0.5 Day", 0.5),
      2: d("يوم", "1 Day", 1),
      3: d("يومان", "2 Days", 2),
      4: d("ثلاثة أيام", "3 Days", 3),
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // ثالثاً: مخالفات تتعلق بالسلوك
  // ══════════════════════════════════════════════════════════════════════════
  {
    code: 50,
    category: "conduct",
    titleAr: "تفوه العامل بما لا يتفق والاحترام الواجب لدين أو عقيدة أثناء العمل",
    titleEn: "Uttering remarks disrespectful of religion or belief during work",
    tiers: {
      1: d("يوم", "1 Day", 1),
      2: d("يومان", "2 Days", 2),
      3: d("إنهاء التعاقد", "Termination of Contract", 5, "termination"),
      4: d("إنهاء التعاقد", "Termination of Contract", 5, "termination"),
    },
  },
  {
    code: 53,
    category: "conduct",
    titleAr:
      "الامتناع عن الحضور أو رفض الإدلاء بالأقوال أثناء التحقيق أو رفض التوقيع على الأقوال أو الامتناع عن تقديم الأوراق والمستندات",
    titleEn: "Refusing to attend investigation, give statements, sign testimony, or submit documents",
    tiers: {
      1: d("خمسة أيام", "5 Days", 5),
      2: d("تأجيل استحقاق العلاوة 3 شهور", "Defer increment by 3 months", 5, "increment_penalty"),
      3: d("خفض الأجر بمقدار علاوة", "Reduce pay by increment", 5, "increment_penalty"),
      4: d("الفصل بعد العرض على اللجنة الخماسية", "Dismissal via Committee", 5, "termination"),
    },
  },
  {
    code: 54,
    category: "conduct",
    titleAr: "الاعتداء بالقول أو الإشارة على الزملاء أو المرؤوسين أو إحداث شغب بدائرة العمل",
    titleEn: "Verbal/gestural assault on colleagues or subordinates or causing workplace disturbance",
    tiers: {
      1: d("ثلاثة أيام", "3 Days", 3),
      2: d("أربعة أيام", "4 Days", 4),
      3: d("خمسة أيام", "5 Days", 5),
      4: d("الحرمان من نصف العلاوة", "Forfeit half annual increment", 5, "increment_penalty"),
    },
  },
  {
    code: 55,
    category: "conduct",
    titleAr: "الاعتداء على الرؤساء",
    titleEn: "Assaulting or disrespecting supervisors / managers",
    tiers: {
      1: d("خمسة أيام", "5 Days", 5),
      2: d("الحرمان من نصف العلاوة", "Forfeit half annual increment", 5, "increment_penalty"),
      3: d("خفض الأجر بمقدار علاوة", "Reduce pay by increment", 5, "increment_penalty"),
      4: d("إنهاء التعاقد", "Termination of Contract", 5, "termination"),
    },
  },
  {
    code: 56,
    category: "conduct",
    titleAr: "خروج العامل على مقتضى اللياقة أو كرامة الوظيفة في مكان العمل",
    titleEn: "Behaving in a manner unbecoming of workplace decency or job dignity",
    tiers: {
      1: d("يوم", "1 Day", 1),
      2: d("يومان", "2 Days", 2),
      3: d("ثلاثة أيام", "3 Days", 3),
      4: d("خمسة أيام", "5 Days", 5),
    },
  },
  {
    code: 57,
    category: "conduct",
    titleAr: "وجود العامل أثناء العمل في حالة السكر أو تحت تأثير مخدر أو ارتكابه أفعالاً مخلة بالآداب",
    titleEn: "Being intoxicated, under the influence of narcotics, or committing immoral acts at work",
    tiers: sameAllTiers(d("إنهاء التعاقد", "Immediate Termination of Contract", 5, "termination")),
  },
  {
    code: 58,
    category: "conduct",
    titleAr: "التمارض أو افتعال الإصابة أو جرح بقصد الحصول على إجازة",
    titleEn: "Feigning illness or self-inflicting injury to obtain leave",
    tiers: {
      1: d("يومان", "2 Days", 2),
      2: d("ثلاثة أيام", "3 Days", 3),
      3: d("خمسة أيام", "5 Days", 5),
      4: d("خفض الأجر بمقدار علاوة", "Reduce pay by increment", 5, "increment_penalty"),
    },
  },
];

/**
 * Computes a worker's daily wage in EGP based on their expected monthly salary or hourly rate.
 */
export function computeWorkerDailyWageEgp(
  worker: { expectedSalary?: number | string; hourlyRate?: number },
  defaultHourlyRate = 31.25,
  standardHours = 8,
): number {
  const monthly = Number(worker.expectedSalary);
  if (Number.isFinite(monthly) && monthly > 0) {
    return Math.round((monthly / 30) * 100) / 100;
  }
  const rate = Number(worker.hourlyRate) || defaultHourlyRate;
  return Math.round(rate * standardHours * 100) / 100;
}

/**
 * Computes the EGP deduction amount for a given disciplinary rule and offense tier (1..4).
 */
export function computeDisciplinaryDeductionEgp(
  rule: DisciplinaryViolationRule,
  tier: OffenseTier,
  dailyWageEgp: number,
): number {
  const spec = rule.tiers[tier];
  if (!spec || spec.deductionDays <= 0) return 0;
  return Math.round(dailyWageEgp * spec.deductionDays * 100) / 100;
}
