import {
  ArrowLeft,
  Award,
  BookCheck,
  CalendarPlus,
  Check,
  Clock,
  Flame,
  Gem,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  X,
  Zap,
} from 'lucide-react';
import { memo, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  IMPORTANCE_META,
  SUBJECT_META,
  SYLLABUS_UNITS,
  findSyllabusUnit,
} from '../data/previewData';
import {
  MissedLessonItem,
  StudyTask,
  TaskImportance,
  TimetableSlot,
} from '../types';
import { formatDeadlineRelative, formatShortDateISO } from '../utils/dateUtils';
import { haptics } from '../utils/haptics';
import {
  CRYSTAL_VALUES,
  XP_VALUES,
  computeSlotReward,
  computeTaskReward,
} from '../utils/progressionEngine';
import { formatDuration, formatTime12h } from '../utils/timeUtils';

export type LinkedSlotStatus = 'completed' | 'partial' | 'overdue' | 'upcoming';

export interface LinkedSlotTimelineEntry {
  slot: TimetableSlot;
  dateISO: string;
  durationMins: number;
  loggedMins: number;
  status: LinkedSlotStatus;
  isUpNext: boolean;
}

export interface UnitPlanOverlayStats {
  timeline: LinkedSlotTimelineEntry[];
  completedCount: number;
  incompleteCount: number;
  overdueCount: number;
  upcomingCount: number;
  loggedMinutes: number;
  scheduledMinutes: number;
}

interface UnitPlanOverlayProps {
  task: StudyTask | null;
  stats: UnitPlanOverlayStats | null;
  missedItems: MissedLessonItem[];
  todayISO: string;
  unitCoveredMap: Record<string, boolean>;
  alreadySlotRewarded: boolean;
  rushActive?: boolean;
  onClose: () => void;
  onUpdateTask: (task: StudyTask) => void;
  onDeleteTask: (taskId: string) => void;
  onSuggestSlot: (task: StudyTask) => void;
  onToggleLinkedSlotComplete: (slot: TimetableSlot) => void;
  onOpenPartialModal: (slot: TimetableSlot, currentLoggedMins: number) => void;
  onDeleteLinkedSlot: (slotId: string) => void;
  onToggleUnitCovered: (unitId: string) => void;
}

export const UnitPlanOverlay = memo(function UnitPlanOverlay({
  task,
  stats,
  missedItems,
  todayISO,
  unitCoveredMap,
  alreadySlotRewarded,
  rushActive = false,
  onClose,
  onUpdateTask,
  onDeleteTask,
  onSuggestSlot,
  onToggleLinkedSlotComplete,
  onOpenPartialModal,
  onDeleteLinkedSlot,
  onToggleUnitCovered,
}: UnitPlanOverlayProps) {
  const [checklistInput, setChecklistInput] = useState('');
  const isOpen = Boolean(task && stats);

  useEffect(() => {
    if (!isOpen || typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [isOpen, onClose]);

  const computed = useMemo(() => {
    if (!task || !stats) return null;

    const subj = SUBJECT_META[task.subject];
    const unit = findSyllabusUnit(task.unitId);
    const imp = IMPORTANCE_META[task.importance ?? 'medium'];
    const deadlineLabel = formatDeadlineRelative(task.deadlineISO, todayISO);
    const unitCovered = unit ? Boolean(unitCoveredMap[unit.id]) : false;

    const totalSlots = stats.timeline.length;
    const completedSlots = stats.completedCount;
    const remainingSlots = Math.max(0, totalSlots - completedSlots);

    const doneSub = task.checklist.filter((c) => c.done).length;
    const totalSub = task.checklist.length;
    const remainingSub = Math.max(0, totalSub - doneSub);

    const totalUnitsOfWork = totalSlots + totalSub;
    const doneUnitsOfWork = completedSlots + doneSub;
    const overallPct =
      task.status === 'completed'
        ? 100
        : totalUnitsOfWork > 0
          ? Math.round((doneUnitsOfWork / totalUnitsOfWork) * 100)
          : task.targetMinutes && task.targetMinutes > 0
            ? Math.min(100, Math.round((stats.loggedMinutes / task.targetMinutes) * 100))
            : 0;

    // Bounty breakdown still available to earn on this unit plan
    let remainingSlotsXp = 0;
    let remainingSlotsCry = 0;
    for (const entry of stats.timeline) {
      if (entry.status !== 'completed') {
        const r = computeSlotReward(entry.slot, missedItems);
        remainingSlotsXp += rushActive ? r.xp * 2 : r.xp;
        remainingSlotsCry += r.cry;
      }
    }

    const wrapReward = computeTaskReward(task, {
      alreadySlotRewarded: alreadySlotRewarded || totalSlots > 0,
    });
    const wrapXp = task.status === 'active' ? (rushActive ? wrapReward.xp * 2 : wrapReward.xp) : 0;
    const wrapCry = task.status === 'active' ? wrapReward.cry : 0;

    const checklistXpLeft =
      remainingSub * XP_VALUES.checklistSubItem * (rushActive ? 2 : 1);
    const checklistCryLeft = remainingSub * CRYSTAL_VALUES.checklistSubItem;

    const unitXpLeft =
      unit && !unitCovered ? XP_VALUES.unitCovered * (rushActive ? 2 : 1) : 0;
    const unitCryLeft = unit && !unitCovered ? CRYSTAL_VALUES.unitCovered : 0;

    const totalXpAvailable =
      remainingSlotsXp + wrapXp + checklistXpLeft + unitXpLeft;
    const totalCryAvailable =
      remainingSlotsCry + wrapCry + checklistCryLeft + unitCryLeft;

    let heroTitle = 'Map Your Multi-Day Unit Plan';
    let heroSubtitle =
      'Schedule focused sessions across days and stack rewards as each step locks in.';

    if (task.status === 'completed') {
      heroTitle = 'Unit Plan Conquered!';
      heroSubtitle = `Every planned milestone is locked in with ${formatDuration(stats.loggedMinutes)} invested.`;
    } else if (totalSlots > 0 && remainingSlots === 0) {
      heroTitle = `All ${totalSlots} ${totalSlots === 1 ? 'Session' : 'Sessions'} Crushed!`;
      heroSubtitle =
        remainingSub > 0
          ? `Only ${remainingSub} checklist ${remainingSub === 1 ? 'step' : 'steps'} left before claiming your wrap-up bonus.`
          : 'Zero sessions remaining — finish this plan now to bank your completion bonus.';
    } else if (totalSlots > 0 && remainingSlots === 1) {
      heroTitle = 'Final Push — Only 1 Session Left!';
      heroSubtitle = `${completedSlots} of ${totalSlots} planned days finished. One last push seals the whole unit.`;
    } else if (totalSlots > 0 && completedSlots === 0) {
      heroTitle = `Day 1 Awaits · ${totalSlots}-Session Plan`;
      heroSubtitle = `Complete the first session to ignite momentum and unlock +${totalXpAvailable} XP across the full plan.`;
    } else if (totalSlots > 0) {
      heroTitle =
        overallPct >= 50
          ? 'Halfway Locked In — Keep Rolling!'
          : 'Momentum Building — Stay Consistent';
      heroSubtitle = `${completedSlots} of ${totalSlots} sessions completed · ${remainingSlots} remaining to finish strong.`;
    }

    return {
      subj,
      unit,
      imp,
      deadlineLabel,
      unitCovered,
      totalSlots,
      completedSlots,
      remainingSlots,
      doneSub,
      totalSub,
      remainingSub,
      overallPct,
      remainingSlotsXp,
      remainingSlotsCry,
      wrapXp,
      wrapCry,
      checklistXpLeft,
      checklistCryLeft,
      unitXpLeft,
      unitCryLeft,
      totalXpAvailable,
      totalCryAvailable,
      heroTitle,
      heroSubtitle,
    };
  }, [
    task,
    stats,
    missedItems,
    todayISO,
    unitCoveredMap,
    alreadySlotRewarded,
    rushActive,
  ]);

  if (!task || !stats || !computed) return null;

  const ringRadius = 50;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset =
    ringCircumference * (1 - Math.max(0, Math.min(100, computed.overallPct)) / 100);

  const handleAddChecklist = () => {
    const clean = checklistInput.trim();
    if (!clean) return;
    haptics.tick();
    onUpdateTask({
      ...task,
      checklist: [
        ...task.checklist,
        {
          id: `chk-${Date.now()}`,
          text: clean,
          done: false,
        },
      ],
    });
    setChecklistInput('');
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${task.title} unit study plan`}
      className="animate-overlay-in sheet-scroll fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-[#D6E6FF] text-[#07142B] dark:bg-[#02081B] dark:text-white"
    >
      {/* Ambient Prism Glow Orbs matching XPArenaOverlay */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -left-24 -top-24 h-80 w-80 rounded-full opacity-75"
          style={{
            background:
              'radial-gradient(circle, rgba(34,211,238,0.34) 0%, rgba(59,130,246,0.12) 48%, rgba(0,0,0,0) 76%)',
          }}
        />
        <div
          className="absolute -bottom-24 -right-24 h-96 w-96 rounded-full opacity-75"
          style={{
            background:
              'radial-gradient(circle, rgba(16,185,129,0.28) 0%, rgba(56,189,248,0.12) 48%, rgba(0,0,0,0) 76%)',
          }}
        />
      </div>

      {/* Sticky Top Command Bar */}
      <header className="ios-glass-topbar sticky top-0 z-20 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-2.5">
          <button
            type="button"
            onClick={() => {
              haptics.tap();
              onClose();
            }}
            className="ios-glass-control inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-transform duration-100 active:scale-95"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Planner</span>
          </button>

          <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold ${computed.subj.bgSoft} ${computed.subj.borderSoft} ${computed.subj.text}`}
            >
              <span className={`h-2 w-2 rounded-full ${computed.subj.bar}`} />
              <span className="truncate">
                {computed.subj.name}
                {computed.unit ? ` · ${computed.unit.code}` : ''}
              </span>
            </span>

            <span
              className={`hidden rounded-full px-2.5 py-1 text-[10.5px] font-bold sm:inline-flex ${computed.imp.activeClass}`}
            >
              {computed.imp.short}
            </span>

            {rushActive && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-1 text-[10.5px] font-bold text-amber-700 dark:text-amber-300">
                <Zap className="h-3 w-3 fill-current" />
                <span>2× Rush</span>
              </span>
            )}
          </div>

          {task.status === 'active' ? (
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onSuggestSlot(task);
              }}
              className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full bg-blue-600 px-3.5 text-xs font-semibold text-white shadow-md shadow-blue-600/25 transition-transform duration-100 active:scale-95 dark:bg-blue-500"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Schedule Day</span>
              <span className="sm:hidden">Add Day</span>
            </button>
          ) : (
            <span className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full bg-emerald-500/20 px-3 text-xs font-bold text-emerald-700 dark:text-emerald-300">
              <Check className="h-3.5 w-3.5 stroke-[2.5]" />
              <span>Done</span>
            </span>
          )}
        </div>
      </header>

      <div className="relative z-10 mx-auto max-w-4xl space-y-4 px-4 pb-28 pt-4 sm:px-6">
        {/* Hero Mastery Stage */}
        <section className="ios-glass-hero rounded-[34px] p-5 sm:p-6">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
            {/* Circular Mastery Ring */}
            <div className="relative flex h-32 w-32 shrink-0 items-center justify-center">
              <svg className="h-32 w-32 -rotate-90" viewBox="0 0 120 120">
                <circle
                  cx="60"
                  cy="60"
                  r={ringRadius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="10"
                  className="text-blue-500/15 dark:text-sky-300/15"
                />
                <circle
                  cx="60"
                  cy="60"
                  r={ringRadius}
                  fill="none"
                  stroke="url(#unitOverlayRingGrad)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                  className="transition-[stroke-dashoffset] duration-500"
                />
                <defs>
                  <linearGradient id="unitOverlayRingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#10B981" />
                    <stop offset="55%" stopColor="#06B6D4" />
                    <stop offset="100%" stopColor="#3B82F6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="tabular-nums text-2xl font-bold tracking-tight">
                  {computed.overallPct}%
                </span>
                <span className="tabular-nums text-[10px] font-semibold uppercase tracking-[0.1em] text-[#0B234A]/65 dark:text-sky-200/70">
                  {computed.totalSlots > 0
                    ? `${computed.completedSlots}/${computed.totalSlots} Days`
                    : `${computed.doneSub}/${computed.totalSub} Steps`}
                </span>
              </div>
            </div>

            {/* Motivational Headline + Key Metrics */}
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-300">
                  <Flame className="h-3 w-3" />
                  <span>{computed.heroTitle}</span>
                </span>
                {computed.deadlineLabel && (
                  <span className="tabular-nums rounded-full bg-orange-500/15 px-2.5 py-0.5 text-[10.5px] font-bold text-orange-700 dark:text-orange-300">
                    {computed.deadlineLabel}
                  </span>
                )}
              </div>

              <h1 className="heading-balance mt-2 text-xl font-bold tracking-tight text-[#07142B] dark:text-white sm:text-2xl">
                {task.title}
              </h1>
              {computed.unit && (
                <p className="mt-0.5 text-xs font-semibold text-blue-700 dark:text-cyan-300">
                  {computed.unit.code}: {computed.unit.title}
                </p>
              )}
              <p className="mt-1.5 text-xs leading-relaxed text-[#0B234A]/75 dark:text-sky-200/80">
                {computed.heroSubtitle}
              </p>

              <div className="mt-3.5 grid grid-cols-3 gap-2">
                <div className="ios-glass-tile rounded-[20px] px-3 py-2 text-center sm:text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0B234A]/60 dark:text-sky-200/65">
                    Invested
                  </p>
                  <p className="tabular-nums mt-0.5 text-sm font-bold text-blue-700 dark:text-cyan-300">
                    {formatDuration(stats.loggedMinutes)}
                  </p>
                </div>
                <div className="ios-glass-tile rounded-[20px] px-3 py-2 text-center sm:text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0B234A]/60 dark:text-sky-200/65">
                    Booked Left
                  </p>
                  <p className="tabular-nums mt-0.5 text-sm font-bold">
                    {formatDuration(stats.scheduledMinutes)}
                  </p>
                </div>
                <div className="ios-glass-tile rounded-[20px] px-3 py-2 text-center sm:text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#0B234A]/60 dark:text-sky-200/65">
                    {task.targetMinutes ? 'Target' : 'Checklist'}
                  </p>
                  <p className="tabular-nums mt-0.5 text-sm font-bold">
                    {task.targetMinutes
                      ? formatDuration(task.targetMinutes)
                      : `${computed.doneSub}/${computed.totalSub}`}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Visual Segmented Day Strip */}
          {stats.timeline.length > 0 && (
            <div className="mt-4 pt-3.5 border-t border-blue-500/15 dark:border-sky-300/15">
              <div className="flex items-center justify-between text-[11px] font-semibold text-[#0B234A]/75 dark:text-sky-200/80">
                <span>Multi-Day Completion Strip</span>
                <span className="tabular-nums">
                  {computed.completedSlots} of {computed.totalSlots} sessions crushed
                </span>
              </div>
              <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${stats.timeline.length}, minmax(0, 1fr))` }}>
                {stats.timeline.map((entry, idx) => {
                  const barTone =
                    entry.status === 'completed'
                      ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.45)]'
                      : entry.status === 'partial'
                        ? 'bg-amber-400'
                        : entry.status === 'overdue'
                          ? 'bg-orange-500/85'
                          : entry.isUpNext
                            ? 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.45)]'
                            : 'bg-blue-500/20 dark:bg-sky-300/20';
                  return (
                    <div key={entry.slot.id} className="space-y-1 text-center">
                      <div className={`h-2.5 w-full rounded-full ${barTone}`} />
                      <p className="tabular-nums truncate text-[10px] font-semibold text-[#0B234A]/70 dark:text-sky-200/75">
                        D{idx + 1} · {formatShortDateISO(entry.dateISO)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Bounty & Motivation Deck */}
        <section className="ios-glass-strong rounded-[30px] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-300">
                <Trophy className="h-4 w-4" />
              </div>
              <div>
                <p className="text-xs font-bold">Reward Bounty Up For Grabs</p>
                <p className="text-[11px] text-[#0B234A]/70 dark:text-sky-200/75">
                  Finish the remaining steps to claim every XP &amp; Crystal stacked in this plan
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="tabular-nums inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-3 py-1 text-xs font-bold text-amber-700 dark:text-amber-300">
                <Sparkles className="h-3.5 w-3.5" />
                +{computed.totalXpAvailable} XP
              </span>
              <span className="tabular-nums inline-flex items-center gap-1 rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-bold text-cyan-700 dark:text-cyan-300">
                <Gem className="h-3.5 w-3.5" />
                +{computed.totalCryAvailable}
              </span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="ios-glass-control rounded-[20px] p-3">
              <p className="text-[10.5px] font-semibold text-[#0B234A]/65 dark:text-sky-200/70">
                Remaining Days
              </p>
              <p className="tabular-nums mt-0.5 text-sm font-bold text-blue-700 dark:text-cyan-300">
                +{computed.remainingSlotsXp} XP
              </p>
              <p className="tabular-nums text-[10px] text-[#0B234A]/60 dark:text-sky-200/65">
                {computed.remainingSlots} {computed.remainingSlots === 1 ? 'slot' : 'slots'} · +{computed.remainingSlotsCry}💎
              </p>
            </div>

            <div className="ios-glass-control rounded-[20px] p-3">
              <p className="text-[10.5px] font-semibold text-[#0B234A]/65 dark:text-sky-200/70">
                Checklist Bonus
              </p>
              <p className="tabular-nums mt-0.5 text-sm font-bold text-emerald-700 dark:text-emerald-300">
                +{computed.checklistXpLeft} XP
              </p>
              <p className="tabular-nums text-[10px] text-[#0B234A]/60 dark:text-sky-200/65">
                {computed.remainingSub} left · +{computed.checklistCryLeft}💎
              </p>
            </div>

            <div className="ios-glass-control rounded-[20px] p-3">
              <p className="text-[10.5px] font-semibold text-[#0B234A]/65 dark:text-sky-200/70">
                Plan Wrap-Up
              </p>
              <p className="tabular-nums mt-0.5 text-sm font-bold text-amber-700 dark:text-amber-300">
                +{computed.wrapXp} XP
              </p>
              <p className="tabular-nums text-[10px] text-[#0B234A]/60 dark:text-sky-200/65">
                On finish · +{computed.wrapCry}💎
              </p>
            </div>

            <div className="ios-glass-control rounded-[20px] p-3">
              <p className="text-[10.5px] font-semibold text-[#0B234A]/65 dark:text-sky-200/70">
                Unit Mastery
              </p>
              <p className="tabular-nums mt-0.5 text-sm font-bold text-violet-700 dark:text-violet-300">
                {computed.unit
                  ? computed.unitCovered
                    ? 'Claimed ✓'
                    : `+${computed.unitXpLeft} XP`
                  : 'No Unit'}
              </p>
              <p className="tabular-nums text-[10px] text-[#0B234A]/60 dark:text-sky-200/65">
                {computed.unit
                  ? computed.unitCovered
                    ? `${computed.unit.code} covered`
                    : `+${computed.unitCryLeft}💎 mastery`
                  : 'Link unit below'}
              </p>
            </div>
          </div>
        </section>

        {/* Chronological Multi-Day Session Timeline */}
        <section className="ios-glass-strong rounded-[30px] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold tracking-tight">
                Chronological Study Timeline ({stats.timeline.length}{' '}
                {stats.timeline.length === 1 ? 'Session' : 'Sessions'})
              </h2>
              <p className="text-[11px] text-[#0B234A]/70 dark:text-sky-200/75">
                Day-by-day view of what is finished, partially logged, overdue, and up next
              </p>
            </div>

            {task.status === 'active' && (
              <button
                type="button"
                onClick={() => {
                  haptics.tap();
                  onSuggestSlot(task);
                }}
                className="ios-glass-control inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold text-blue-700 transition-transform duration-100 active:scale-95 dark:text-cyan-300"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Day Session</span>
              </button>
            )}
          </div>

          {stats.timeline.length === 0 ? (
            <div className="ios-glass-control mt-3 rounded-[24px] px-4 py-6 text-center">
              <Clock className="mx-auto h-7 w-7 text-blue-600/75 dark:text-cyan-300/80" />
              <p className="mt-2 text-xs font-semibold">
                No Timetable slots mapped for this plan yet
              </p>
              <p className="mt-0.5 text-[11px] text-[#0B234A]/70 dark:text-sky-200/75">
                Drop sessions across multiple days to track Day 1, Day 2, Day 3 completion here.
              </p>
              {task.status === 'active' && (
                <button
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    onSuggestSlot(task);
                  }}
                  className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-blue-600 px-4 text-xs font-semibold text-white shadow-md shadow-blue-600/25 transition-transform duration-100 active:scale-95 dark:bg-blue-500"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  <span>Schedule First Session</span>
                </button>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {stats.timeline.map((entry, idx) => {
                const slotReward = computeSlotReward(entry.slot, missedItems);
                const xpPreview = rushActive ? slotReward.xp * 2 : slotReward.xp;
                const isDone = entry.status === 'completed';
                const isPartial = entry.status === 'partial';
                const isOverdue = entry.status === 'overdue';

                const cardSurface = isDone
                  ? 'border-emerald-400/50 bg-emerald-500/12 dark:border-emerald-400/35 dark:bg-emerald-500/14'
                  : isPartial
                    ? 'border-amber-400/55 bg-amber-500/12 dark:border-amber-400/35 dark:bg-amber-500/14'
                    : isOverdue
                      ? 'border-orange-400/55 bg-orange-500/12 dark:border-orange-400/35 dark:bg-orange-500/14'
                      : entry.isUpNext
                        ? 'border-cyan-400/65 bg-cyan-500/14 ring-1 ring-cyan-400/45 dark:border-cyan-300/45 dark:bg-cyan-500/15'
                        : 'border-white/55 bg-white/40 dark:border-sky-300/20 dark:bg-sky-950/35';

                return (
                  <div
                    key={entry.slot.id}
                    className={`perf-card flex flex-wrap items-center justify-between gap-3 rounded-[24px] border p-3.5 transition-colors ${cardSurface}`}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <div
                        className={`tabular-nums flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-2xl text-[10px] font-bold ${
                          isDone
                            ? 'animate-check-pop bg-emerald-500 text-white'
                            : isPartial
                              ? 'bg-amber-500 text-white'
                              : isOverdue
                                ? 'bg-orange-500 text-white'
                                : entry.isUpNext
                                  ? 'bg-blue-600 text-white dark:bg-cyan-400 dark:text-[#041226]'
                                  : 'bg-blue-500/15 text-blue-700 dark:bg-sky-300/15 dark:text-cyan-200'
                        }`}
                      >
                        <span className="leading-none">Day</span>
                        <span className="text-xs leading-tight">{idx + 1}</span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="tabular-nums text-xs font-bold">
                            {entry.slot.day} {formatShortDateISO(entry.dateISO)} ·{' '}
                            {formatTime12h(entry.slot.startTime)}
                          </span>
                          <span className="tabular-nums text-[11px] font-medium text-[#0B234A]/65 dark:text-sky-200/70">
                            ({formatDuration(entry.durationMins)})
                          </span>
                          {entry.slot.revisionStage && (
                            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700 dark:text-violet-300">
                              {entry.slot.revisionStage}
                            </span>
                          )}
                        </div>

                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                          {isDone ? (
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-300">
                              <Check className="h-3 w-3 stroke-[3]" />
                              Crushed ({formatDuration(entry.loggedMins)})
                            </span>
                          ) : isPartial ? (
                            <span className="tabular-nums font-bold text-amber-700 dark:text-amber-300">
                              ↺ Partial ({formatDuration(entry.loggedMins)} / {formatDuration(entry.durationMins)})
                            </span>
                          ) : isOverdue ? (
                            <span className="font-bold text-orange-700 dark:text-orange-300">
                              ! Overdue — Finish or Reschedule (+{xpPreview} XP)
                            </span>
                          ) : entry.isUpNext ? (
                            <span className="font-bold text-blue-700 dark:text-cyan-300">
                              🔥 Up Next · +{xpPreview} XP · +{slotReward.cry}💎
                            </span>
                          ) : (
                            <span className="text-[#0B234A]/70 dark:text-sky-200/75">
                              Scheduled · +{xpPreview} XP · +{slotReward.cry}💎
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          haptics.success();
                          onToggleLinkedSlotComplete(entry.slot);
                        }}
                        title={isDone ? 'Undo completion' : 'Mark session done'}
                        className={`inline-flex min-h-[36px] items-center gap-1 rounded-full px-3 text-xs font-semibold transition-transform duration-100 active:scale-95 ${
                          isDone
                            ? 'bg-emerald-500 text-white'
                            : 'bg-emerald-500/18 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>{isDone ? 'Done' : 'Complete'}</span>
                      </button>

                      {!isDone && (
                        <button
                          type="button"
                          onClick={() => {
                            haptics.tap();
                            onOpenPartialModal(
                              entry.slot,
                              entry.loggedMins || Math.round(entry.durationMins / 2),
                            );
                          }}
                          title="Log partial study time"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-orange-500/15 text-orange-700 transition-transform duration-100 active:scale-90 dark:text-orange-300"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          haptics.tap();
                          onDeleteLinkedSlot(entry.slot.id);
                        }}
                        title="Remove slot from Timetable"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/10 text-[#0B234A]/65 transition-transform duration-100 active:scale-90 dark:text-sky-200/75"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {task.status === 'active' && (
                <button
                  type="button"
                  onClick={() => {
                    haptics.tap();
                    onSuggestSlot(task);
                  }}
                  className="ios-glass-control flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-full text-xs font-semibold text-blue-700 transition-transform duration-100 active:scale-[0.99] dark:text-cyan-300"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  <span>+ Suggest &amp; Add Another Day Session</span>
                </button>
              )}
            </div>
          )}
        </section>

        {/* Action Checklist + Plan Settings */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* Checklist & Notes */}
          <section className="ios-glass-strong rounded-[30px] p-4 sm:p-5 lg:col-span-7">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold">Checklist &amp; Sub-Topics</p>
              <span className="tabular-nums text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                +{XP_VALUES.checklistSubItem} XP per step
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {task.checklist.length === 0 ? (
                <p className="ios-glass-control rounded-[20px] px-3.5 py-3 text-xs text-[#0B234A]/70 dark:text-sky-200/75">
                  Break this unit down into quick sub-steps (e.g., Theory summary, 2022 Paper II).
                </p>
              ) : (
                task.checklist.map((item) => (
                  <div
                    key={item.id}
                    className="ios-glass-control flex items-center justify-between gap-2 rounded-full px-3.5 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        haptics.tick();
                        onUpdateTask({
                          ...task,
                          checklist: task.checklist.map((c) =>
                            c.id === item.id ? { ...c, done: !c.done } : c,
                          ),
                        });
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                          item.done
                            ? 'border-emerald-500 bg-emerald-500 text-white'
                            : 'border-blue-400/55'
                        }`}
                      >
                        {item.done && <Check className="h-3 w-3 stroke-[2.5]" />}
                      </span>
                      <span
                        className={`truncate text-xs ${
                          item.done ? 'line-through opacity-60' : 'font-medium'
                        }`}
                      >
                        {item.text}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateTask({
                          ...task,
                          checklist: task.checklist.filter((c) => c.id !== item.id),
                        })
                      }
                      aria-label="Remove item"
                      className="text-[#0B234A]/50 hover:text-orange-600 dark:text-sky-200/50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="mt-2.5 flex gap-2">
              <input
                type="text"
                value={checklistInput}
                onChange={(e) => setChecklistInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && checklistInput.trim()) {
                    e.preventDefault();
                    handleAddChecklist();
                  }
                }}
                placeholder="Add sub-step (e.g., Past Paper 2021 Q4)..."
                className="ios-glass-control min-h-[40px] flex-1 rounded-full px-3.5 text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddChecklist}
                className="ios-glass-control min-h-[40px] rounded-full px-4 text-xs font-semibold transition-transform duration-100 active:scale-95"
              >
                Add
              </button>
            </div>

            <textarea
              rows={3}
              value={task.notes}
              onChange={(e) => onUpdateTask({ ...task, notes: e.target.value })}
              placeholder="Study notes (where you stopped, weak formulas, tricky questions)..."
              className="ios-glass-control mt-3 w-full rounded-[22px] px-3.5 py-2.5 text-xs focus:outline-none"
            />
          </section>

          {/* Plan Controls & Syllabus Unit Coverage */}
          <section className="ios-glass-strong flex flex-col justify-between gap-3 rounded-[30px] p-4 sm:p-5 lg:col-span-5">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Target className="h-4 w-4 text-blue-600 dark:text-cyan-300" />
                <p className="text-sm font-bold">Plan Controls</p>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#0B234A]/70 dark:text-sky-200/75">
                  Syllabus Unit
                </label>
                <select
                  value={task.unitId ?? ''}
                  onChange={(e) =>
                    onUpdateTask({ ...task, unitId: e.target.value || undefined })
                  }
                  className="ios-glass-control mt-1 min-h-[40px] w-full rounded-full px-3.5 text-xs font-semibold text-[#07142B] focus:outline-none dark:text-white"
                >
                  <option
                    value=""
                    className="bg-[#DCE8FA] text-[#07142B] dark:bg-[#081533] dark:text-white"
                  >
                    No Syllabus Unit
                  </option>
                  {SYLLABUS_UNITS[task.subject].map((u) => (
                    <option
                      key={u.id}
                      value={u.id}
                      className="bg-[#DCE8FA] text-[#07142B] dark:bg-[#081533] dark:text-white"
                    >
                      {u.code}: {u.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#0B234A]/70 dark:text-sky-200/75">
                  Target Deadline
                </label>
                <input
                  type="date"
                  value={task.deadlineISO ?? ''}
                  min={todayISO}
                  onChange={(e) =>
                    onUpdateTask({ ...task, deadlineISO: e.target.value || undefined })
                  }
                  className="ios-glass-control tabular-nums mt-1 min-h-[40px] w-full rounded-full px-3.5 text-xs font-semibold focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#0B234A]/70 dark:text-sky-200/75">
                  Priority Tier
                </label>
                <div className="ios-glass-control mt-1 grid grid-cols-4 gap-1 rounded-full p-1">
                  {(['low', 'medium', 'high', 'urgent'] as TaskImportance[]).map((impKey) => (
                    <button
                      key={impKey}
                      type="button"
                      onClick={() => {
                        haptics.tick();
                        onUpdateTask({ ...task, importance: impKey });
                      }}
                      className={`min-h-[32px] rounded-full text-[11px] font-semibold transition-colors ${
                        (task.importance ?? 'medium') === impKey
                          ? IMPORTANCE_META[impKey].activeClass
                          : IMPORTANCE_META[impKey].text
                      }`}
                    >
                      {IMPORTANCE_META[impKey].short}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-[#0B234A]/70 dark:text-sky-200/75">
                    Default Session (m)
                  </label>
                  <input
                    type="number"
                    min={15}
                    step={15}
                    value={task.defaultSessionMins}
                    onChange={(e) => {
                      const val = Math.max(15, Math.round(Number(e.target.value) || 30));
                      onUpdateTask({ ...task, defaultSessionMins: val });
                    }}
                    className="ios-glass-control tabular-nums mt-1 min-h-[38px] w-full rounded-full px-3 text-center text-xs font-bold focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[#0B234A]/70 dark:text-sky-200/75">
                    Target Goal (hrs)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    value={
                      task.targetMinutes
                        ? Math.round((task.targetMinutes / 60) * 10) / 10
                        : ''
                    }
                    placeholder="Optional"
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      onUpdateTask({
                        ...task,
                        targetMinutes:
                          !isNaN(val) && val > 0 ? Math.round(val * 60) : undefined,
                      });
                    }}
                    className="ios-glass-control tabular-nums mt-1 min-h-[38px] w-full rounded-full px-3 text-center text-xs font-bold focus:outline-none"
                  />
                </div>
              </div>
            </div>

            {/* Syllabus Unit Mastery 1-Tap Bonus */}
            {computed.unit && (
              <div className="ios-glass-tile rounded-[22px] p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[#07142B] dark:text-white">
                      {computed.unit.code} Mastery Badge
                    </p>
                    <p className="truncate text-[10.5px] text-[#0B234A]/70 dark:text-sky-200/75">
                      {computed.unitCovered
                        ? 'Unit marked covered in Syllabus'
                        : `Earn +${XP_VALUES.unitCovered} XP & +${CRYSTAL_VALUES.unitCovered}💎`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      haptics.success();
                      onToggleUnitCovered(computed.unit!.id);
                    }}
                    className={`inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-transform duration-100 active:scale-95 ${
                      computed.unitCovered
                        ? 'bg-emerald-500 text-white'
                        : 'bg-violet-600 text-white dark:bg-violet-500'
                    }`}
                  >
                    {computed.unitCovered ? (
                      <>
                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                        <span>Covered</span>
                      </>
                    ) : (
                      <>
                        <Award className="h-3.5 w-3.5" />
                        <span>Master Unit</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Bottom Primary CTA Deck */}
        <section className="ios-glass-strong flex flex-wrap items-center gap-2.5 rounded-[28px] p-3.5">
          <button
            type="button"
            onClick={() => {
              haptics.tap();
              onDeleteTask(task.id);
              onClose();
            }}
            aria-label="Delete unit plan"
            className="ios-glass-control inline-flex min-h-[48px] items-center justify-center rounded-full px-4 text-xs font-semibold text-orange-600 transition-transform duration-100 active:scale-95 dark:text-orange-300"
          >
            <Trash2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              haptics.success();
              onUpdateTask({
                ...task,
                status: task.status === 'active' ? 'completed' : 'active',
              });
              onClose();
            }}
            className={`inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-full px-5 text-xs font-bold shadow-lg transition-transform duration-100 active:scale-[0.98] ${
              task.status === 'active'
                ? 'bg-emerald-600 text-white shadow-emerald-600/25 dark:bg-emerald-500'
                : 'ios-glass-control text-[#07142B] dark:text-white'
            }`}
          >
            {task.status === 'active' ? (
              <>
                <BookCheck className="h-4 w-4" />
                <span>Mark Unit Plan Complete (+{computed.wrapXp} XP)</span>
              </>
            ) : (
              <>
                <RotateCcw className="h-4 w-4" />
                <span>Reopen Unit Plan</span>
              </>
            )}
          </button>

          {task.status === 'active' && (
            <button
              type="button"
              onClick={() => {
                haptics.tap();
                onSuggestSlot(task);
              }}
              className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-full bg-blue-600 px-5 text-xs font-bold text-white shadow-lg shadow-blue-600/25 transition-transform duration-100 active:scale-[0.98] dark:bg-blue-500"
            >
              <CalendarPlus className="h-4 w-4" />
              <span>+ Schedule Next</span>
            </button>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
});
