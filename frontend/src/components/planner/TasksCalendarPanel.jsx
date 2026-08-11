import { useCallback, useEffect, useState } from "react";
import { TypeChip } from "../ui/FinanceChips";

const TABS = ["tasks", "calendar"];

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

  const load = useCallback(async () => {
    if (!activeFamilyId || !apiGet) return;
    setLoading(true);
    setError("");
    try {
      const [taskRows, eventRows] = await Promise.all([
        apiGet(`/tasks/${activeFamilyId}`),
        apiGet(`/calendar/${activeFamilyId}`),
      ]);
      setTasks(Array.isArray(taskRows) ? taskRows : taskRows?.tasks || []);
      setEvents(Array.isArray(eventRows) ? eventRows : eventRows?.events || []);
    } catch (err) {
      setTasks([]);
      setEvents([]);
      setError(err?.message || "Planner load failed");
    } finally {
      setLoading(false);
    }
  }, [activeFamilyId, apiGet]);

  useEffect(() => {
    void load();
  }, [load]);

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
      await load();
    } catch (err) {
      setError(err?.message || "Create task failed");
    } finally {
      setLoading(false);
    }
  }

  async function completeTask(taskId) {
    setBusyId(taskId);
    try {
      await apiPost(`/tasks/${taskId}/complete?family_id=${encodeURIComponent(activeFamilyId)}`, {});
      await load();
    } catch (err) {
      setError(err?.message || "Complete failed");
    } finally {
      setBusyId("");
    }
  }

  async function deleteTask(taskId) {
    setBusyId(taskId);
    try {
      if (apiDelete) {
        await apiDelete(`/tasks/${taskId}?family_id=${encodeURIComponent(activeFamilyId)}`);
      } else {
        await apiPost(`/tasks/${taskId}/complete?family_id=${encodeURIComponent(activeFamilyId)}`, {});
      }
      await load();
    } catch (err) {
      setError(err?.message || "Delete failed");
    } finally {
      setBusyId("");
    }
  }

  async function createEvent() {
    if (!eventForm.title.trim() || !eventForm.event_date) {
      setError(t("eventRequired") || "Title and date required");
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
      await load();
    } catch (err) {
      setError(err?.message || "Create event failed");
    } finally {
      setLoading(false);
    }
  }

  async function deleteEvent(eventId) {
    setBusyId(eventId);
    try {
      if (apiDelete) {
        await apiDelete(`/calendar/${eventId}?family_id=${encodeURIComponent(activeFamilyId)}`);
      } else if (apiPatch) {
        await apiPatch(`/calendar/${eventId}?family_id=${encodeURIComponent(activeFamilyId)}`, {
          status: "CANCELLED",
        });
      }
      await load();
    } catch (err) {
      setError(err?.message || "Delete event failed");
    } finally {
      setBusyId("");
    }
  }

  const openTasks = tasks.filter((row) => String(row.status || "").toUpperCase() !== "DONE").length;
  const upcomingEvents = events.length;

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

      {error ? <p className="settings-empty">{error}</p> : null}

      {tab === "tasks" ? (
        <div className="settings-stack">
          <div className="settings-block">
            <h4>{t("createTask")}</h4>
            <div className="finance-form">
              <input
                placeholder={t("taskTitle")}
                value={taskForm.title}
                onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
              />
              <input
                placeholder={t("note")}
                value={taskForm.description}
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
                {["LOW", "MEDIUM", "HIGH"].map((p) => (
                  <option key={p} value={p}>
                    {p}
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
                  const done = status === "DONE";
                  return (
                    <div className="finance-card tx-card is-savings" key={task.id}>
                      <div className="tx-row">
                        <div className="tx-row-type">
                          <TypeChip type={done ? "SAVINGS" : "PENDING"}>{status}</TypeChip>
                        </div>
                        <div className="tx-row-copy">
                          <strong>{task.title}</strong>
                          <span className="tx-row-sub">
                            {task.priority || "MEDIUM"}
                            {task.due_date ? ` · ${digits(task.due_date)}` : ""}
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
                onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
              />
              <input
                placeholder={t("note")}
                value={eventForm.description}
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
                {["GENERAL", "MEETING", "REMINDER", "FAMILY"].map((type) => (
                  <option key={type} value={type}>
                    {type}
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
                  {digits(events.length)} {t("navCalendar")}
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
                        <TypeChip type="TRANSFER">{event.event_type || "GENERAL"}</TypeChip>
                      </div>
                      <div className="tx-row-copy">
                        <strong>{event.title}</strong>
                        <span className="tx-row-sub">
                          {event.event_date ? digits(event.event_date) : "—"}
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
