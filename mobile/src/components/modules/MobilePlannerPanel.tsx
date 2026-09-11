import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { tMobile, type MobileLang } from "../../i18n";

type TaskRow = {
  id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority?: string;
  status?: string;
};

type EventRow = {
  id: string;
  title: string;
  description?: string | null;
  event_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  event_type?: string;
  status?: string;
};

type Props = {
  token: string;
  familyId: string;
  apiGet: (path: string, authToken?: string) => Promise<any>;
  apiPost: (path: string, body: object, authToken?: string) => Promise<any>;
  apiDelete?: (path: string, authToken?: string) => Promise<any>;
  onMessage: (message: string, ok?: boolean) => void;
  lang?: MobileLang;
};

type PlannerSub = "TASKS" | "CALENDAR";

export function MobilePlannerPanel({
  token,
  familyId,
  apiGet,
  apiPost,
  apiDelete,
  onMessage,
  lang = "bn",
}: Props) {
  const tm = (key: string) => tMobile(lang, key);
  const [sub, setSub] = useState<PlannerSub>("TASKS");
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [taskForm, setTaskForm] = useState({ title: "", description: "", due_date: "", priority: "MEDIUM" });
  const [eventForm, setEventForm] = useState({
    title: "",
    description: "",
    event_date: "",
    start_time: "",
    end_time: "",
    event_type: "GENERAL",
  });

  const load = useCallback(async () => {
    if (!token || !familyId) return;
    setLoading(true);
    try {
      const [taskRows, eventRows] = await Promise.all([
        apiGet(`/api/v1/tasks/${familyId}`, token),
        apiGet(`/api/v1/calendar/${familyId}`, token),
      ]);
      setTasks(Array.isArray(taskRows) ? taskRows : taskRows?.tasks || []);
      setEvents(Array.isArray(eventRows) ? eventRows : eventRows?.events || []);
      onMessage(tm("plannerLoaded") || "Planner loaded", true);
    } catch (error) {
      setTasks([]);
      setEvents([]);
      onMessage(error instanceof Error ? error.message : "Planner load failed", false);
    } finally {
      setLoading(false);
    }
  }, [apiGet, familyId, onMessage, token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTask() {
    if (!taskForm.title.trim()) {
      onMessage(tm("titleRequired") || "Title required", false);
      return;
    }
    setLoading(true);
    try {
      await apiPost(
        "/api/v1/tasks",
        {
          family_id: familyId,
          title: taskForm.title.trim(),
          description: taskForm.description.trim() || null,
          due_date: taskForm.due_date || null,
          priority: taskForm.priority || "MEDIUM",
        },
        token
      );
      setTaskForm({ title: "", description: "", due_date: "", priority: "MEDIUM" });
      await load();
      onMessage(tm("taskCreated") || "Task created", true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Create task failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function completeTask(taskId: string) {
    setLoading(true);
    try {
      await apiPost(`/api/v1/tasks/${taskId}/complete?family_id=${encodeURIComponent(familyId)}`, {}, token);
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Complete failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function deleteTask(taskId: string) {
    setLoading(true);
    try {
      if (apiDelete) {
        await apiDelete(`/api/v1/tasks/${taskId}?family_id=${encodeURIComponent(familyId)}`, token);
      } else {
        await apiPost(`/api/v1/tasks/${taskId}/complete?family_id=${encodeURIComponent(familyId)}`, {}, token);
      }
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Delete failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function createEvent() {
    if (!eventForm.title.trim() || !eventForm.event_date.trim()) {
      onMessage(tm("eventRequired") || "Title and date required", false);
      return;
    }
    setLoading(true);
    try {
      await apiPost(
        "/api/v1/calendar",
        {
          family_id: familyId,
          title: eventForm.title.trim(),
          description: eventForm.description.trim() || null,
          event_date: eventForm.event_date.trim(),
          start_time: eventForm.start_time || null,
          end_time: eventForm.end_time || null,
          event_type: eventForm.event_type || "GENERAL",
        },
        token
      );
      setEventForm({
        title: "",
        description: "",
        event_date: "",
        start_time: "",
        end_time: "",
        event_type: "GENERAL",
      });
      await load();
      onMessage(tm("eventCreated") || "Event created", true);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Create event failed", false);
    } finally {
      setLoading(false);
    }
  }

  async function deleteEvent(eventId: string) {
    setLoading(true);
    try {
      if (apiDelete) {
        await apiDelete(`/api/v1/calendar/${eventId}?family_id=${encodeURIComponent(familyId)}`, token);
      }
      await load();
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Delete event failed", false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.panel}>
      <View style={styles.rowBetween}>
        <Text style={styles.panelTitle}>{tm("planner") || "Planner"}</Text>
        <Pressable onPress={() => void load()} disabled={loading}>
          <Text style={styles.linkText}>{loading ? "..." : tm("refresh")}</Text>
        </Pressable>
      </View>

      <View style={styles.statusRow}>
        {(
          [
            ["TASKS", "navTasks"],
            ["CALENDAR", "navCalendar"],
          ] as const
        ).map(([id, key]) => (
          <Pressable key={id} onPress={() => setSub(id)}>
            <Text style={[styles.statusPill, sub === id ? styles.ok : null]}>{tm(key) || id}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.grid}>
        <Metric label={tm("navTasks") || "Tasks"} value={String(tasks.length)} />
        <Metric label={tm("navCalendar") || "Calendar"} value={String(events.length)} />
      </View>

      {sub === "TASKS" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createTask") || "Create task"}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("taskTitle") || "Title"}
            placeholderTextColor="#8aa39a"
            value={taskForm.title}
            onChangeText={(title) => setTaskForm((c) => ({ ...c, title }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("description") || "Description"}
            placeholderTextColor="#8aa39a"
            value={taskForm.description}
            onChangeText={(description) => setTaskForm((c) => ({ ...c, description }))}
          />
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#8aa39a"
            value={taskForm.due_date}
            onChangeText={(due_date) => setTaskForm((c) => ({ ...c, due_date }))}
          />
          <View style={styles.statusRow}>
            {["LOW", "MEDIUM", "HIGH"].map((p) => (
              <Pressable key={p} onPress={() => setTaskForm((c) => ({ ...c, priority: p }))}>
                <Text style={[styles.statusPill, taskForm.priority === p ? styles.ok : null]}>{p}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable style={styles.primaryButton} onPress={() => void createTask()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{tm("createTask") || "Create task"}</Text>
          </Pressable>

          {tasks.length === 0 ? <Text style={styles.muted}>{tm("noTasks") || "No tasks"}</Text> : null}
          {tasks.map((task) => {
            const done = String(task.status || "").toUpperCase() === "DONE";
            return (
              <View style={styles.listRow} key={task.id}>
                <Text style={styles.listTitle}>{task.title}</Text>
                <Text style={styles.muted}>
                  {task.status || "OPEN"} · {task.priority || "MEDIUM"}
                  {task.due_date ? ` · ${task.due_date}` : ""}
                </Text>
                {!done ? (
                  <Pressable style={styles.secondaryButton} onPress={() => void completeTask(task.id)} disabled={loading}>
                    <Text style={styles.secondaryButtonText}>{tm("complete") || "Complete"}</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.secondaryButton} onPress={() => void deleteTask(task.id)} disabled={loading}>
                  <Text style={styles.secondaryButtonText}>{tm("delete") || "Delete"}</Text>
                </Pressable>
              </View>
            );
          })}
        </>
      ) : null}

      {sub === "CALENDAR" ? (
        <>
          <Text style={styles.sectionLabel}>{tm("createEvent") || "Create event"}</Text>
          <TextInput
            style={styles.input}
            placeholder={tm("eventTitle") || "Title"}
            placeholderTextColor="#8aa39a"
            value={eventForm.title}
            onChangeText={(title) => setEventForm((c) => ({ ...c, title }))}
          />
          <TextInput
            style={styles.input}
            placeholder={tm("description") || "Description"}
            placeholderTextColor="#8aa39a"
            value={eventForm.description}
            onChangeText={(description) => setEventForm((c) => ({ ...c, description }))}
          />
          <TextInput
            style={styles.input}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#8aa39a"
            value={eventForm.event_date}
            onChangeText={(event_date) => setEventForm((c) => ({ ...c, event_date }))}
          />
          <TextInput
            style={styles.input}
            placeholder="HH:MM start"
            placeholderTextColor="#8aa39a"
            value={eventForm.start_time}
            onChangeText={(start_time) => setEventForm((c) => ({ ...c, start_time }))}
          />
          <TextInput
            style={styles.input}
            placeholder="HH:MM end"
            placeholderTextColor="#8aa39a"
            value={eventForm.end_time}
            onChangeText={(end_time) => setEventForm((c) => ({ ...c, end_time }))}
          />
          <Pressable style={styles.primaryButton} onPress={() => void createEvent()} disabled={loading}>
            <Text style={styles.primaryButtonText}>{tm("createEvent") || "Create event"}</Text>
          </Pressable>

          {events.length === 0 ? <Text style={styles.muted}>{tm("noEvents") || "No events"}</Text> : null}
          {events.map((event) => (
            <View style={styles.listRow} key={event.id}>
              <Text style={styles.listTitle}>{event.title}</Text>
              <Text style={styles.muted}>
                {event.event_date || "—"}
                {event.start_time ? ` · ${event.start_time}` : ""}
                {event.end_time ? `–${event.end_time}` : ""} · {event.event_type || "GENERAL"}
              </Text>
              <Pressable style={styles.secondaryButton} onPress={() => void deleteEvent(event.id)} disabled={loading}>
                <Text style={styles.secondaryButtonText}>{tm("delete") || "Delete"}</Text>
              </Pressable>
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  panelTitle: { color: "#17211e", fontSize: 18, fontWeight: "900" },
  linkText: { color: "#0f8f6f", fontWeight: "800", fontSize: 12 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  statusPill: {
    fontSize: 11,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "#edf7f3",
    color: "#6c7b76",
    fontWeight: "700",
    overflow: "hidden",
  },
  ok: { backgroundColor: "#0f8f6f", color: "#ffffff" },
  grid: { flexDirection: "row", gap: 8 },
  metricCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 12,
  },
  metricLabel: { color: "#6c7b76", fontSize: 10, fontWeight: "700" },
  metricValue: { color: "#17211e", fontSize: 16, fontWeight: "900", marginTop: 4 },
  sectionLabel: { color: "#17211e", fontSize: 12, fontWeight: "900", marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: "#dce7e3",
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#17211e",
  },
  primaryButton: {
    backgroundColor: "#0f8f6f",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonText: { color: "#ffffff", fontWeight: "800" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#dce7e3",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 6,
    backgroundColor: "#f8fbfa",
  },
  secondaryButtonText: { color: "#17211e", fontWeight: "700", fontSize: 12 },
  listRow: {
    borderWidth: 1,
    borderColor: "#dce7e3",
    borderRadius: 14,
    padding: 12,
    backgroundColor: "#ffffff",
    gap: 4,
  },
  listTitle: { color: "#17211e", fontWeight: "900", fontSize: 13 },
  muted: { color: "#6c7b76", fontSize: 11 },
});
