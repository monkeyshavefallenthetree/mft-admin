"use client";

import { useState } from "react";
import ModalPortal from "@/components/admin/ui/ModalPortal";
import { type HrSettings, DEFAULT_HR_SETTINGS } from "@/lib/admin/hrReports";
import { saveHrSettings } from "@/lib/admin/hrSettings";
import { toast } from "@/lib/admin/feedback";

interface Props {
  initialSettings: HrSettings;
  onClose: () => void;
  adminEmail?: string;
}

const WEEKEND_OPTIONS = [
  { value: 5, label: "Friday (الجمعة)" },
  { value: 6, label: "Saturday (السبت)" },
  { value: 0, label: "Sunday (الأحد)" },
  { value: 4, label: "Thursday (الخميس)" },
];

export default function HrPolicyModal({ initialSettings, onClose, adminEmail }: Props) {
  const [settings, setSettings] = useState<HrSettings>({ ...initialSettings });
  const [saving, setSaving] = useState(false);

  const toggleWeekend = (day: number) => {
    setSettings((prev) => {
      const exists = prev.weekendDays.includes(day);
      if (exists) {
        if (prev.weekendDays.length <= 1) {
          toast.warning("At least one weekly rest day is required");
          return prev;
        }
        return { ...prev, weekendDays: prev.weekendDays.filter((d) => d !== day) };
      }
      return { ...prev, weekendDays: [...prev.weekendDays, day].sort() };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveHrSettings(settings, adminEmail);
      toast.success("HR & Payroll policies updated");
      onClose();
    } catch (err) {
      toast.error("Failed to save settings", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="fixed inset-0 z-[120] bg-zinc-950/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto animate-fade-in"
        onClick={onClose}
      >
        <div
          className="bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-2xl w-full max-w-xl max-h-[92vh] overflow-y-auto p-6 md:p-8 animate-scale-in text-zinc-950 dark:text-zinc-100 font-mono"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between pb-4 border-b-2 border-zinc-900 dark:border-zinc-700 mb-6">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 px-2 py-0.5 rounded">
                // SYSTEM SETTINGS
              </span>
              <h3 className="text-xl md:text-2xl font-bold font-heading uppercase tracking-wide mt-1 text-zinc-950 dark:text-white">
                HR &amp; Payroll Policies
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                Configure when the monthly cycle starts, shift hours, grace periods, and weekly rest days.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-950 dark:hover:text-white text-2xl font-bold leading-none p-1 cursor-pointer"
            >
              &times;
            </button>
          </div>

          <form onSubmit={handleSave} className="space-y-6 text-xs">
            {/* 1. Month Cycle Start Control */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-bold text-sm text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                    <span className="text-red-600">●</span> Month Start Day (بداية الشهر المالي)
                  </h4>
                  <p className="text-zinc-500 dark:text-zinc-400 text-[11px] mt-0.5">
                    Controls the cutoff day for all monthly attendance, hours, and payroll reports.
                  </p>
                </div>
                <span className="px-2.5 py-1 bg-red-600 text-white font-bold rounded text-xs">
                  Day {settings.monthStartDay}
                </span>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 pt-1">
                {[
                  { day: 21, label: "21st (21st–20th)", sub: "Egypt Standard" },
                  { day: 25, label: "25th (25th–24th)", sub: "Late Cutoff" },
                  { day: 1, label: "1st (Calendar)", sub: "1st–End of Month" },
                  { day: 15, label: "15th (15th–14th)", sub: "Mid-month" },
                ].map((preset) => (
                  <button
                    key={preset.day}
                    type="button"
                    onClick={() => setSettings({ ...settings, monthStartDay: preset.day })}
                    className={`p-2 rounded border text-left cursor-pointer transition-all ${
                      settings.monthStartDay === preset.day
                        ? "border-red-600 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 ring-2 ring-red-600/20 font-bold"
                        : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    }`}
                  >
                    <div className="font-bold text-xs">{preset.label}</div>
                    <div className="text-[10px] text-zinc-400 mt-0.5">{preset.sub}</div>
                  </button>
                ))}
              </div>

              <div className="pt-2 flex items-center gap-3">
                <label className="text-[11px] font-bold text-zinc-700 dark:text-zinc-300 uppercase">
                  Custom Day of Month (1–28):
                </label>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={settings.monthStartDay}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      monthStartDay: Math.min(28, Math.max(1, parseInt(e.target.value, 10) || 1)),
                    })
                  }
                  className="w-20 px-2 py-1 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 text-center font-bold text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
              </div>
            </div>

            {/* 2. Weekly Rest Days */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700 rounded-lg space-y-3">
              <h4 className="font-bold text-sm text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <span className="text-red-600">●</span> Weekly Rest Days (أيام العطلة الأسبوعية)
              </h4>
              <p className="text-zinc-500 dark:text-zinc-400 text-[11px]">
                Rest days are excluded from required work days. Workers are not marked absent on these days.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {WEEKEND_OPTIONS.map((opt) => {
                  const checked = settings.weekendDays.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => toggleWeekend(opt.value)}
                      className={`p-2.5 rounded border text-left flex items-center justify-between cursor-pointer transition-all ${
                        checked
                          ? "border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold"
                          : "border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
                      }`}
                    >
                      <span>{opt.label}</span>
                      <span className="text-sm">{checked ? "✓" : "○"}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Shift Start & Grace Period */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700 rounded-lg space-y-3">
              <h4 className="font-bold text-sm text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <span className="text-red-600">●</span> Shift Schedule &amp; Lateness Policy (مواعيد العمل والتأخير)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 uppercase mb-1">
                    Shift Start (بداية الوردية)
                  </label>
                  <select
                    value={settings.shiftStartTime}
                    onChange={(e) => setSettings({ ...settings, shiftStartTime: e.target.value })}
                    className="w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value="08:00">08:00 AM</option>
                    <option value="08:30">08:30 AM</option>
                    <option value="09:00">09:00 AM</option>
                    <option value="09:30">09:30 AM</option>
                    <option value="10:00">10:00 AM (Default)</option>
                    <option value="10:30">10:30 AM</option>
                    <option value="11:00">11:00 AM</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 uppercase mb-1">
                    Grace Period (سماحية التأخير)
                  </label>
                  <select
                    value={settings.gracePeriodMinutes}
                    onChange={(e) =>
                      setSettings({ ...settings, gracePeriodMinutes: parseInt(e.target.value, 10) || 60 })
                    }
                    className="w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>60 minutes (1h)</option>
                    <option value={90}>90 minutes (1.5h)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 uppercase mb-1">
                    Standard Shift (ساعات الوردية)
                  </label>
                  <select
                    value={settings.standardHours}
                    onChange={(e) =>
                      setSettings({ ...settings, standardHours: parseInt(e.target.value, 10) || 8 })
                    }
                    className="w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value={6}>6 hours</option>
                    <option value={7}>7 hours</option>
                    <option value={8}>8 hours (Standard)</option>
                    <option value={9}>9 hours</option>
                    <option value={10}>10 hours</option>
                  </select>
                </div>
              </div>

              <p className="text-[10px] text-zinc-500 pt-1">
                Workers clocking in within the grace period are considered On-Time. Check-ins after are flagged Late (0.25 day deduction) or Very Late (0.5 day deduction after {settings.secondThresholdMinutes}m).
              </p>
            </div>

            {/* 4. Overtime & Rates */}
            <div className="p-4 bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-300 dark:border-zinc-700 rounded-lg space-y-3">
              <h4 className="font-bold text-sm text-zinc-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <span className="text-red-600">●</span> Overtime &amp; Absence Multipliers (مضاعف الإضافي والغياب)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 uppercase mb-1">
                    Overtime Multiplier (مضاعف الساعات الإضافية)
                  </label>
                  <select
                    value={settings.overtimeMultiplier}
                    onChange={(e) =>
                      setSettings({ ...settings, overtimeMultiplier: parseFloat(e.target.value) || 1.5 })
                    }
                    className="w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value={1.25}>1.25x hourly rate</option>
                    <option value={1.5}>1.50x hourly rate (Standard)</option>
                    <option value={1.75}>1.75x hourly rate</option>
                    <option value={2.0}>2.00x hourly rate (Double)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-zinc-700 dark:text-zinc-300 uppercase mb-1">
                    Absence Penalty (جزاء الغياب بدون إذن)
                  </label>
                  <select
                    value={settings.absencePenaltyMultiplier}
                    onChange={(e) =>
                      setSettings({ ...settings, absencePenaltyMultiplier: parseInt(e.target.value, 10) || 2 })
                    }
                    className="w-full bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
                  >
                    <option value={1}>1x daily pay (خصم يوم)</option>
                    <option value={2}>2x daily pay (خصم يومين - Standard)</option>
                    <option value={3}>3x daily pay (خصم ثلاثة أيام)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-3 border-t-2 border-zinc-900 dark:border-zinc-700">
              <button
                type="button"
                onClick={() => setSettings(DEFAULT_HR_SETTINGS)}
                className="text-xs text-zinc-500 hover:text-red-600 underline font-mono cursor-pointer"
              >
                Reset to Defaults
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 font-bold uppercase cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer disabled:opacity-50"
                >
                  {saving ? "Saving Policies..." : "Save Policies"}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </ModalPortal>
  );
}
