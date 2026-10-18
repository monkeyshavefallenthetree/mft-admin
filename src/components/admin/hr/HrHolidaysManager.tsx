"use client";

import { useState } from "react";
import { type HolidayItem } from "@/lib/admin/hrReports";
import { addHoliday, deleteHoliday, seedDefaultEgyptianHolidays } from "@/lib/admin/hrSettings";
import { toast, confirmDialog } from "@/lib/admin/feedback";

interface Props {
  holidays: HolidayItem[];
  adminEmail?: string;
  onOpenPolicyModal?: () => void;
}

export default function HrHolidaysManager({ holidays, adminEmail, onOpenPolicyModal }: Props) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [form, setForm] = useState<{
    name: string;
    date: string;
    endDate: string;
    type: "national" | "religious" | "company" | "special";
    isPaid: boolean;
    notes: string;
  }>({
    name: "",
    date: new Date().toISOString().split("T")[0],
    endDate: "",
    type: "national",
    isPaid: true,
    notes: "",
  });

  const todayStr = new Date().toISOString().split("T")[0];

  const upcomingHolidays = holidays.filter((h) => (h.endDate || h.date) >= todayStr);
  const pastHolidays = holidays.filter((h) => (h.endDate || h.date) < todayStr);

  const getDaysUntil = (dateStr: string) => {
    const today = new Date(todayStr + "T00:00:00");
    const target = new Date(dateStr + "T00:00:00");
    const diffMs = target.getTime() - today.getTime();
    const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
    if (days === 0) return "Today! 🎉";
    if (days === 1) return "Tomorrow";
    if (days > 1) return `In ${days} days`;
    return "Past";
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.date) {
      toast.warning("Please enter a holiday name and date");
      return;
    }
    try {
      await addHoliday(
        {
          name: form.name.trim(),
          date: form.date,
          endDate: form.endDate || undefined,
          type: form.type,
          isPaid: form.isPaid,
          notes: form.notes.trim() || undefined,
        },
        adminEmail,
      );
      toast.success(`Holiday "${form.name}" added`);
      setForm({
        name: "",
        date: todayStr,
        endDate: "",
        type: "national",
        isPaid: true,
        notes: "",
      });
      setShowAddForm(false);
    } catch (err) {
      toast.error("Failed to add holiday", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleDelete = async (h: HolidayItem) => {
    const ok = await confirmDialog({
      title: "Remove Holiday?",
      message: `Are you sure you want to remove "${h.name}" (${h.date})? Workday calculations will re-include this date.`,
      confirmLabel: "Remove Holiday",
    });
    if (!ok) return;

    try {
      await deleteHoliday(h.id);
      toast.success(`Holiday "${h.name}" removed`);
    } catch (err) {
      toast.error("Failed to delete holiday", {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleSeedEgyptian = async () => {
    setSeeding(true);
    try {
      const added = await seedDefaultEgyptianHolidays(adminEmail);
      if (added === 0) {
        toast.info("Egyptian holidays are already up to date in your calendar");
      } else {
        toast.success(`Imported ${added} official Egyptian holidays successfully`);
      }
    } catch (err) {
      toast.error("Failed to import holidays", {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSeeding(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Control Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-5 bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[4px_4px_0px_0px_#09090b] rounded-lg">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 px-2 py-0.5 rounded font-mono">
            {"// STATUTORY CALENDAR"}
          </span>
          <h3 className="text-xl md:text-2xl font-bold font-heading uppercase tracking-wide text-zinc-950 dark:text-white mt-1">
            Official Holidays &amp; Rest Days (جدول العطلات الرسمية)
          </h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400 font-mono mt-1 max-w-2xl">
            Official holidays are automatically subtracted from required work days. Workers who do not log in on these dates are <strong>protected from absence deductions</strong>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenPolicyModal && (
            <button
              type="button"
              onClick={onOpenPolicyModal}
              className="px-3.5 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 font-mono text-xs font-bold uppercase tracking-wider cursor-pointer"
            >
              ⚙️ Shift &amp; Cycle Policies
            </button>
          )}
          <button
            type="button"
            disabled={seeding}
            onClick={handleSeedEgyptian}
            className="px-3.5 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-950 dark:text-zinc-100 font-mono text-xs font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <span>🇪🇬</span>
            <span>{seeding ? "Importing..." : "Import Egypt Holidays"}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-mono text-xs font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
          >
            {showAddForm ? "Cancel" : "+ Add Holiday"}
          </button>
        </div>
      </div>

      {/* Add Holiday Form (Collapsible) */}
      {showAddForm && (
        <form
          onSubmit={handleAdd}
          className="p-5 bg-zinc-50 dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 shadow-[3px_3px_0px_0px_#09090b] rounded-lg space-y-4 font-mono text-xs animate-fade-in"
        >
          <div className="flex items-center justify-between border-b-2 border-zinc-900 dark:border-zinc-700 pb-2">
            <h4 className="font-bold text-sm text-zinc-950 dark:text-white uppercase tracking-wider">
              Add New Official Holiday or Company Off-Day
            </h4>
            <span className="text-[11px] text-zinc-500">Auto-saved to Firestore</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                Holiday Name * (اسم العطلة)
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. 6th of October Victory Day or Eid Al-Fitr Holiday"
                className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                Holiday Type (النوع)
              </label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as "national" | "religious" | "company" | "special" })}
                className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
              >
                <option value="national">National Holiday (عطلة قومية)</option>
                <option value="religious">Religious Holiday (عطلة دينية)</option>
                <option value="company">Company Day Off (إجازة للشركة)</option>
                <option value="special">Special Allowance (عطلة خاصة)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                Start Date * (تاريخ البدء)
              </label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                End Date (Optional for multi-day e.g. Eid)
              </label>
              <input
                type="date"
                value={form.endDate}
                min={form.date}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 font-bold focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>

            <div>
              <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
                Paid Holiday Status
              </label>
              <div className="flex items-center gap-2 pt-2">
                <label className="flex items-center gap-2 font-bold cursor-pointer text-zinc-800 dark:text-zinc-200">
                  <input
                    type="checkbox"
                    checked={form.isPaid}
                    onChange={(e) => setForm({ ...form, isPaid: e.target.checked })}
                    className="h-4 w-4 accent-red-600 cursor-pointer"
                  />
                  <span>Paid Statutory Holiday (مدفوعة الأجر)</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="block font-bold uppercase text-zinc-700 dark:text-zinc-300 mb-1">
              Notes / Description (Optional)
            </label>
            <input
              type="text"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="e.g. Official declaration by Cabinet of Ministers"
              className="w-full bg-white dark:bg-zinc-800 border-2 border-zinc-900 dark:border-zinc-700 px-3 py-2 text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 border-2 border-zinc-900 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-950 dark:text-zinc-100 font-bold uppercase cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold uppercase tracking-wider border-2 border-zinc-900 shadow-[2px_2px_0px_0px_#09090b] cursor-pointer"
            >
              Save Holiday
            </button>
          </div>
        </form>
      )}

      {/* Upcoming Holidays Section */}
      <div className="space-y-3 font-mono">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold uppercase tracking-wider text-zinc-900 dark:text-white flex items-center gap-2">
            <span className="text-emerald-600">●</span> Upcoming Official Holidays ({upcomingHolidays.length})
          </h4>
          <span className="text-[11px] text-zinc-500">Auto-exempt from absence deductions</span>
        </div>

        {upcomingHolidays.length === 0 ? (
          <div className="p-8 text-center bg-white dark:bg-zinc-900 border-2 border-zinc-900 dark:border-zinc-700 rounded-lg">
            <p className="text-zinc-500 italic text-xs">No upcoming holidays configured for this period.</p>
            <button
              type="button"
              onClick={handleSeedEgyptian}
              className="mt-3 text-red-600 font-bold underline hover:text-red-700 cursor-pointer text-xs"
            >
              + Click here to import official Egyptian national holidays
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {upcomingHolidays.map((h) => {
              const countdown = getDaysUntil(h.date);
              const isToday = countdown === "Today! 🎉";
              return (
                <div
                  key={h.id}
                  className={`p-4 border-2 border-zinc-900 dark:border-zinc-700 rounded-lg flex flex-col justify-between transition-all ${
                    isToday
                      ? "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-600 shadow-[4px_4px_0px_0px_#059669]"
                      : "bg-white dark:bg-zinc-900 shadow-[3px_3px_0px_0px_#09090b]"
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-bold text-sm text-zinc-950 dark:text-white font-heading">
                        {h.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase whitespace-nowrap border ${
                          isToday
                            ? "bg-emerald-600 text-white border-emerald-700 animate-pulse"
                            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700"
                        }`}
                      >
                        {countdown}
                      </span>
                    </div>

                    <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-2 space-y-1">
                      <div className="font-bold text-zinc-900 dark:text-zinc-200">
                        📅 {h.date} {h.endDate && h.endDate !== h.date ? `→ ${h.endDate}` : ""}
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <span className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-[10px] uppercase font-bold">
                          {h.type}
                        </span>
                        {h.isPaid && (
                          <span className="text-[10px] text-emerald-700 dark:text-emerald-400 font-bold">
                            ✓ Paid Day Off
                          </span>
                        )}
                      </div>
                      {h.notes && <p className="text-[11px] text-zinc-500 italic mt-1">{h.notes}</p>}
                    </div>
                  </div>

                  <div className="pt-3 mt-3 border-t border-zinc-200 dark:border-zinc-800 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleDelete(h)}
                      className="text-[10px] text-red-600 hover:text-red-700 font-bold uppercase tracking-wider cursor-pointer"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Past Holidays Archive */}
      {pastHolidays.length > 0 && (
        <div className="space-y-3 font-mono pt-4 border-t border-zinc-200 dark:border-zinc-800">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Past Holidays Archive ({pastHolidays.length})
          </h4>
          <div className="divide-y divide-zinc-200 dark:divide-zinc-800 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs">
            {pastHolidays.map((h) => (
              <div key={h.id} className="p-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-zinc-700 dark:text-zinc-300">{h.name}</span>
                  <span className="text-[11px] text-zinc-400">{h.date}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 uppercase">
                    {h.type}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(h)}
                  className="text-zinc-400 hover:text-red-600 text-xs font-bold cursor-pointer"
                >
                  &times; Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
