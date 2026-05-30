import React, { useState } from "react";

const amd = value => `${Number(value || 0).toLocaleString("hy-AM")} AMD`;

export function PeopleEmployeeForm({ onCreate, actionState }) {
  const [fullName, setFullName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [position, setPosition] = useState("");
  const [department, setDepartment] = useState("");
  const [grossSalary, setGrossSalary] = useState("");
  const [hireDate, setHireDate] = useState("");
  const [email, setEmail] = useState("");
  const busy = actionState === "employee:create";
  function submit() {
    if (fullName.trim().length < 2) return;
    if (taxId && !/^\d{8}$/.test(taxId.trim())) return;
    onCreate({
      fullName: fullName.trim(),
      taxId: taxId.trim(),
      position: position.trim(),
      department: department.trim(),
      grossSalary: Math.max(0, Math.round(Number(grossSalary) || 0)),
      hireDate,
      email: email.trim()
    });
    setFullName(""); setTaxId(""); setPosition(""); setDepartment(""); setGrossSalary(""); setHireDate(""); setEmail("");
  }
  return (
    <article className="panel people-employee-form-panel">
      <div className="panel-head"><div><span className="section-label">Armosphera People</span><h2>New employee</h2></div></div>
      <div className="inline-form">
        <input value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Անուն Ազգանուն" />
        <input value={taxId} onChange={event => setTaxId(event.target.value)} inputMode="numeric" placeholder="ՀՎՀՀ (8 նիշ)" />
        <input value={position} onChange={event => setPosition(event.target.value)} placeholder="Պաշտոն" />
        <input value={department} onChange={event => setDepartment(event.target.value)} placeholder="Բաժին" />
        <input value={grossSalary} onChange={event => setGrossSalary(event.target.value)} inputMode="numeric" placeholder="Աշխատավարձ (AMD)" />
        <input type="date" value={hireDate} onChange={event => setHireDate(event.target.value)} />
        <input value={email} onChange={event => setEmail(event.target.value)} placeholder="Էլ. փոստ" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Saving" : "Add employee"}</button>
      </div>
    </article>
  );
}

export function PeopleRegistryPanel({ data, onRunPayroll, actionState }) {
  const employees = (data && data.employees) || [];
  const activeCount = employees.filter(employee => employee.employmentStatus === "active").length;
  return (
    <article className="panel people-registry-panel">
      <div className="panel-head">
        <div><span className="section-label">Armosphera People</span><h2>Employees</h2></div>
        <strong className="aging-badge">{activeCount} active</strong>
      </div>
      <div className="rows">
        {employees.map(employee => (
          <div className="row" key={employee.id}>
            <span>{employee.fullName} · {employee.position || "—"} · {employee.department || "—"} · <strong>{employee.employmentStatus}</strong> · {amd(employee.grossSalary)}</span>
            {employee.employmentStatus !== "terminated" && onRunPayroll && (
              <button
                className="mini-action"
                type="button"
                disabled={actionState === `payroll:${employee.id}`}
                onClick={() => onRunPayroll(employee.id)}
              >
                {actionState === `payroll:${employee.id}` ? "Running" : "Run payroll"}
              </button>
            )}
          </div>
        ))}
        {employees.length === 0 && <div className="row"><span>No employees yet</span></div>}
      </div>
    </article>
  );
}
