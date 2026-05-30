import React, { useState } from "react";

const PROJECT_STATUSES = ["planning", "active", "on-hold", "completed", "cancelled"];

function hours(minutes) {
  const h = Math.floor((minutes || 0) / 60);
  const m = (minutes || 0) % 60;
  return m ? `${h}ժ ${m}ր` : `${h}ժ`;
}

export function ProjectCreateForm({ customers, onCreate, actionState }) {
  const list = customers || [];
  const [name, setName] = useState("");
  const [status, setStatus] = useState("planning");
  const [customerId, setCustomerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const busy = actionState === "project:create";
  function submit() {
    if (name.trim().length < 3) return;
    onCreate({ name: name.trim(), status, customerId: customerId || undefined, dueDate: dueDate || undefined });
    setName(""); setCustomerId(""); setDueDate("");
  }
  return (
    <article className="panel project-create-panel">
      <div className="panel-head"><div><span className="section-label">Armosphera Projects</span><h2>New project</h2></div></div>
      <div className="inline-form">
        <input value={name} onChange={event => setName(event.target.value)} placeholder="Անվանում (name)" />
        <select value={status} onChange={event => setStatus(event.target.value)}>
          {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={customerId} onChange={event => setCustomerId(event.target.value)}>
          <option value="">— Հաճախորդ (ըստ ցանկության) —</option>
          {list.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
        </select>
        <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Saving" : "Create project"}</button>
      </div>
    </article>
  );
}

export function ProjectsBoardPanel({ data, canWrite, onAddTask, onToggleTask, onUpdateStatus, onLogTime, actionState }) {
  const projects = (data && data.projects) || [];
  const [taskTitle, setTaskTitle] = useState({});
  const [timeMin, setTimeMin] = useState({});
  return (
    <article className="panel projects-board-panel">
      <div className="panel-head">
        <div><span className="section-label">Armosphera Projects</span><h2>Projects</h2></div>
        <strong className="aging-badge">{projects.filter(p => p.status === "active").length} active</strong>
      </div>
      <div className="rows">
        {projects.map(project => {
          const busy = actionState === `project:act:${project.id}`;
          return (
            <div className="row" key={project.id} style={{ flexDirection: "column", alignItems: "stretch", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
                <span>{project.name} · <strong>{project.status}</strong></span>
                <span>
                  {project.taskDone}/{project.taskTotal} tasks · {project.milestoneReached}/{project.milestoneTotal} milestones · {hours(project.totalMinutes)}
                </span>
              </div>
              {canWrite && (
                <div className="inline-form" style={{ gap: "6px", flexWrap: "wrap" }}>
                  <select value="" disabled={busy} onChange={event => { if (event.target.value) onUpdateStatus(project.id, event.target.value); }}>
                    <option value="">Set status…</option>
                    {PROJECT_STATUSES.filter(s => s !== project.status).map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <input
                    value={taskTitle[project.id] || ""}
                    onChange={event => setTaskTitle({ ...taskTitle, [project.id]: event.target.value })}
                    placeholder="Նոր առաջադրանք"
                  />
                  <button className="mini-action" type="button" disabled={busy || !(taskTitle[project.id] || "").trim()} onClick={() => { onAddTask(project.id, (taskTitle[project.id] || "").trim()); setTaskTitle({ ...taskTitle, [project.id]: "" }); }}>Add task</button>
                  <input
                    value={timeMin[project.id] || ""}
                    onChange={event => setTimeMin({ ...timeMin, [project.id]: event.target.value })}
                    inputMode="numeric"
                    placeholder="Րոպեներ"
                    style={{ width: "90px" }}
                  />
                  <button className="mini-action" type="button" disabled={busy || !(Number(timeMin[project.id]) > 0)} onClick={() => { onLogTime(project.id, Math.round(Number(timeMin[project.id]))); setTimeMin({ ...timeMin, [project.id]: "" }); }}>Log time</button>
                </div>
              )}
            </div>
          );
        })}
        {projects.length === 0 && <div className="row"><span>No projects yet</span></div>}
      </div>
    </article>
  );
}
