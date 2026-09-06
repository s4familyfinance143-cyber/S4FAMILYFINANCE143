import { useCallback, useEffect, useRef, useState } from "react";
import { TypeChip } from "../ui/FinanceChips";

const TABS = ["tasks", "calendar"];

const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const EVENT_TYPES = ["GENERAL", "MEETING", "REMINDER", "FAMILY"];

function isTaskOpen(status) {
  const s = String(status || "OPEN").toUpperCase();
  return s !== "DONE" && s !== "COMPLETED" && s !== "CANCELLED";
}

function formatPlannerDate(value, digits) {
  const raw = String(value || "").trim();
  if (!raw) return "—";
  // Prefer locale display for yyyy-mm-dd without mutating digits helper
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [y, m, d] = raw.slice(0, 10).split("-");
    return `${digits(d)}/${digits(m)}/${digits(y)}`;
  }
  return digits(raw);
}

function priorityLabel(priority, t) {
  const p = String(priority || "MEDIUM").toUpperCase();
  if (p === "LOW") return t("priorityLow") || "LOW";
  if (p === "HIGH") return t("priorityHigh") || "HIGH";
  return t("priorityMedium") || "MEDIUM";
}

function eventTypeLabel(type, t) {
  const v = String(type || "GENERAL").toUpperCase();
  if (v === "MEETING") return t("eventTypeMeeting") || "MEETING";
  if (v === "REMINDER") return t("eventTypeReminder") || "REMINDER";
  if (v === "FAMILY") return t("eventTypeFamily") || "FAMILY";
  return t("eventTypeGeneral") || "GENERAL";
}

function statusLabel(status, t) {
  const s = String(status || "OPEN").toUpperCase();
  if (s === "DONE" || s === "COMPLETED") return t("completedStatus") || "DONE";
  if (s === "CANCELLED") return t("cancelledStatus") || "CANCELLED";
  if (s === "SCHEDULED") return t("scheduledStatus") || "SCHEDULED";
  return t("statusOpen") || "OPEN";
}

export function TasksCalendarPanel({
  t,
  digits,
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  activeFamilyId,
}) {
  const [tab, setTab] = useState("tasks");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [taskForm, setTaskForm] = useState({
    title: "",
    description: "",
    due_date: "",
    priority: "MEDIUM",
  });
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    event_date: "",
    start_time: "",
    end_time: "",
    event_type: "GENERAL",
  });
  const [error, setError] = useState("");
  const [banner, setBanner] = useState(null);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    if (!activeFamilyId || !apiGet) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    try {
      const [taskRows, eventRows] = await Promise.all([
        apiGet(`/tasks/${activeFamilyId}`),
        apiGet(`/calendar/${activeFamilyId}`),
      ]);
      if (seq !== loadSeq.current) return;
      setTasks(Array.isArray(taskRows) ? taskRows : taskRows?.tasks || []);
      setEvents(Array.isArray(eventRows) ? eventRows : eventRows?.events || []);
    } catch (err) {
      if (seq !== loadSeq.current) return;
      // Keep last known lists — do not wipe UI to zeros on transient errors
      setError(err?.message || t("plannerLoadFailed") || "Planner load failed");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
    // apiGet identity changes every render — depend only on family id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFamilyId]);

  useEffect(() => {
    void load();
  }, [load]);

  function flash(message, type = "success") {
    const text = String(message || "").trim();
    if (!text) return;
    setBanner({ text, type });
    window.setTimeout(() => {
      setBanner((prev) => (prev?.text === text ? null : prev));
    }, 3200);
  }

  async function createTask() {
    if (!taskForm.title.trim()) {
      setError(t("titleRequired") || "Title required");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiPost("/tasks", {
        family_id: activeFamilyId,
        title: taskForm.title.trim(),
        description: taskForm.description.trim() || null,
        due_date: taskForm.due_date || null,
        priority: taskForm.priority || "MEDIUM",
      });
      setTaskForm({ title: "", description: "", due_date: "", priority: "MEDIUM" });
      flash(t("taskCreatedOk") || "Task created");
      await load();
    } catch (err) {
      setError(err?.message || t("createTaskFailed") || "Create task failed");
    } finally {
      setLoading(false);
    }
  }

  async function completeTask(taskId) {
    setBusyId(taskId);
    setError("");
    try {
      await apiPost(`/tasks/${taskId}/complete?family_id=${encodeURIComponent(activeFamilyId)}`, {});
      flash(t("taskCompletedOk") || "Task completed");
      await load();
    } catch (err) {
      // Fallback if older shim/backend misses /complete
      try {
        if (apiPatch) {
          await apiPatch(`/tasks/${taskId}?family_id=${encodeURIComponent(activeFamilyId)}`, {
            status: "DONE",
          });
          flash(t("taskCompletedOk") || "Task completed");
          await load();
          return;
        }
      } catch {
        /* fall through */
      }
      setError(err?.message || t("completeFailed") || "Complete failed");
    } finally {
      setBusyId("");
    }
  }

  async function deleteTask(taskId) {
    if (!apiDelete) {
      setError(t("deleteUnavailable") || "Delete unavailable");
      return;
    }
    if (!window.confirm(t("confirmDeleteTask") || "Delete this task?")) return;
    setBusyId(taskId);
    setError("");
    try {
      await apiDelete(`/tasks/${taskId}?family_id=${encodeURIComponent(activeFamilyId)}`);
      flash(t("taskDeletedOk") || "Task deleted");
      await load();
    } catch (err) {
      setError(err?.message || t("deleteFailed") || "Delete failed");
    } finally {
      setBusyId("");
    }
  }

  async function createEvent() {
    if (!eventForm.title.trim() || !eventForm.event_date) {
      setError(t("eventRequired") || "Title and date required");
      return;
    }
    if (
      eventForm.start_time &&
      eventForm.end_time &&
      eventForm.end_time < eventForm.start_time
    ) {
      setError(t("endTimeAfterStart") || "End time must be after start time");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await apiPost("/calendar", {
        family_id: activeFamilyId,
        title: eventForm.title.trim(),
        description: eventForm.description.trim() || null,
        event_date: eventForm.event_date,
        start_time: eventForm.start_time || null,
        end_time: eventForm.end_time || null,
        event_type: eventForm.event_type || "GENERAL",
      });
      setEventForm({
        title: "",
        description: "",
        event_date: "",
        start_time: "",
        end_time: "",
        event_type: "GENERAL",
      });
      flash(t("eventCreatedOk") || "Event created");
      await load();
    } catch (err) {
      setError(err?.message || t("createEventFailed") || "Create event failed");
    } finally {
      setLoading(false);
    }
  }

  async function deleteEvent(eventId) {
    if (!window.confirm(t("confirmDeleteEvent") || "Delete this event?")) return;
    setBusyId(eventId);
    setError("");
    try {
      if (apiDelete) {
        await apiDelete(`/calendar/${eventId}?family_id=${encodeURIComponent(activeFamilyId)}`);
      } else if (apiPatch) {
        await apiPatch(`/calendar/${eventId}?family_id=${encodeURIComponent(activeFamilyId)}`, {
          status: "CANCELLED",
        });
      } else {
        throw new Error(t("deleteUnavailable") || "Delete unavailable");
      }
      flash(t("eventDeletedOk") || "Event deleted");
      await load();
    } catch (err) {
      setError(err?.message || t("deleteEventFailed") || "Delete event failed");
    } finally {
      setBusyId("");
    }
  }

  const openTasks = tasks.filter((row) => isTaskOpen(row.status)).length;
  const upcomingEvents = events.filter(
    (row) => String(row.status || "").toUpperCase() !== "CANCELLED",
  ).length;

  return (
    <section className="panel settings-panel settings-smart finance-smart">
      <div className="settings-head">
        <div>
          <p className="settings-kicker">{t("planner")}</p>
          <h2>{t("planner")}</h2>
        </div>
        <button type="button" className="btn" disabled={loading} onClick={() => void load()}>
          {loading ? t("loading") : t("refresh")}
        </button>
      </div>

      <div className="settings-tabs" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? "settings-tab active" : "settings-tab"}
            onClick={() => setTab(key)}
          >
            {key === "tasks" ? t("navTasks") : t("navCalendar")}
          </button>
        ))}
      </div>

      <div className="settings-stat-row">
        <div className="settings-stat">
          <span>{t("navTasks")}</span>
          <strong>{digits(tasks.length)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("pending")}</span>
          <strong>{digits(openTasks)}</strong>
        </div>
        <div className="settings-stat">
          <span>{t("navCalendar")}</span>
          <strong>{digits(upcomingEvents)}</strong>
        </div>
      </div>

      {banner ? (
        <p className={banner.type === "success" ? "status ok" : "status error"} role="status">
          {banner.text}
        </p>
      ) : null}
      {error ? <p className="settings-empty">{error}</p> : null}

      {tab === "tasks" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("createTask")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("taskTitle")}
                value={taskForm.title}
                maxLength={200}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              />
              <input
                placeholder={t("note")}
                value={taskForm.description}
                maxLength={500}
                onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
              />
              <input
                type="date"
                aria-label={t("dueDate")}
                value={taskForm.due_date}
                onChange={(e) => setTaskForm({ ...taskForm, due_date: e.target.value })}
              />
              <select
                aria-label={t("priority")}
                value={taskForm.priority}
                onChange={(e) => setTaskForm({ ...taskForm, priority: e.target.value })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p, t)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void createTask()}>
                {t("createTask")}
              </button>
            </div>
          </div>

          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("navTasks")}</h4>
                <p>
                  {digits(tasks.length)} · {digits(openTasks)} {t("pending")}
                </p>
              </div>
            </div>
            {loading && !tasks.length ? (
              <p className="settings-empty">{t("loading")}</p>
            ) : tasks.length === 0 ? (
              <p className="settings-empty">{t("noTasks")}</p>
            ) : (
              <div className="finance-feed">
                {tasks.map((task) => {
                  const status = String(task.status || "OPEN").toUpperCase();
                  const done = !isTaskOpen(status);
                  return (
                    <div className="finance-card tx-card is-savings" key={task.id}>
                      <div className="tx-row">
                        <div className="tx-row-type">
                          <TypeChip type={done ? "SAVINGS" : "PENDING"}>{statusLabel(status, t)}</TypeChip>
                        </div>
                        <div className="tx-row-copy">
                          <strong>{task.title}</strong>
                          <span className="tx-row-sub">
                            {priorityLabel(task.priority, t)}
                            {task.due_date ? ` · ${formatPlannerDate(task.due_date, digits)}` : ""}
                            {task.description ? ` · ${task.description}` : ""}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {!done ? (
                            <button
                              type="button"
                              className="btn btn-primary"
                              disabled={busyId === task.id}
                              onClick={() => void completeTask(task.id)}
                            >
                              {t("complete")}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn"
                            disabled={busyId === task.id}
                            onClick={() => void deleteTask(task.id)}
                          >
                            {t("delete")}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {tab === "calendar" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("createEvent")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("eventTitle")}
                value={eventForm.title}
                maxLength={200}
                onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
              />
              <input
                placeholder={t("note")}
                value={eventForm.description}
                maxLength={500}
                onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
              />
              <input
                type="date"
                aria-label={t("eventDate")}
                value={eventForm.event_date}
                onChange={(e) => setEventForm({ ...eventForm, event_date: e.target.value })}
              />
              <input
                type="time"
                aria-label={t("startTime")}
                value={eventForm.start_time}
                onChange={(e) => setEventForm({ ...eventForm, start_time: e.target.value })}
              />
              <input
                type="time"
                aria-label={t("endTime")}
                value={eventForm.end_time}
                onChange={(e) => setEventForm({ ...eventForm, end_time: e.target.value })}
              />
              <select
                aria-label={t("eventType")}
                value={eventForm.event_type}
                onChange={(e) => setEventForm({ ...eventForm, event_type: e.target.value })}
              >
                {EVENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {eventTypeLabel(type, t)}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void createEvent()}>
                {t("createEvent")}
              </button>
            </div>
          </div>

          <div className="settings-block">
            <div className="settings-block-head">
              <div>
                <h4>{t("navCalendar")}</h4>
                <p>
                  {digits(upcomingEvents)} {t("navCalendar")}
                </p>
              </div>
            </div>
            {loading && !events.length ? (
              <p className="settings-empty">{t("loading")}</p>
            ) : events.length === 0 ? (
              <p className="settings-empty">{t("noEvents")}</p>
            ) : (
              <div className="finance-feed">
                {events.map((event) => (
                  <div className="finance-card tx-card is-savings" key={event.id}>
                    <div className="tx-row">
                      <div className="tx-row-type">
                        <TypeChip type="TRANSFER">{eventTypeLabel(event.event_type, t)}</TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong>{event.title}</strong>
                        <span className="tx-row-sub">
                          {formatPlannerDate(event.event_date, digits)}
                          {event.start_time ? ` · ${event.start_time}` : ""}
                          {event.end_time ? `–${event.end_time}` : ""}
                          {event.description ? ` · ${event.description}` : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === event.id}
                        onClick={() => void deleteEvent(event.id)}
                      >
                        {t("delete")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
