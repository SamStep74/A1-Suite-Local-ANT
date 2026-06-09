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
      <div className="panel-head"><div><span className="section-label">A1 People</span><h2>New employee</h2></div></div>
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

const EMPLOYMENT_STATUSES = ["active", "on-leave", "terminated"];

function EmployeeEditor({ employee, onUpdate, actionState }) {
  const [status, setStatus] = useState(employee.employmentStatus);
  const [grossSalary, setGrossSalary] = useState(String(employee.grossSalary || 0));
  const [position, setPosition] = useState(employee.position || "");
  const busy = actionState === `employee:update:${employee.id}`;
  function save() {
    const patch = {
      employmentStatus: status,
      grossSalary: Math.max(0, Math.round(Number(grossSalary) || 0)),
      position: position.trim()
    };
    onUpdate(employee.id, patch);
  }
  return (
    <div className="inline-form employee-editor">
      <select value={status} onChange={event => setStatus(event.target.value)}>
        {EMPLOYMENT_STATUSES.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <input value={grossSalary} onChange={event => setGrossSalary(event.target.value)} inputMode="numeric" placeholder="Աշխատավարձ (AMD)" />
      <input value={position} onChange={event => setPosition(event.target.value)} placeholder="Պաշտոն" />
      <button className="mini-action" type="button" disabled={busy} onClick={save}>{busy ? "Saving" : "Save"}</button>
    </div>
  );
}

function PayrollHistory({ employeeId, onLoadHistory }) {
  const [runs, setRuns] = useState(null); // null = not loaded, [] = loaded-empty
  const [error, setError] = useState("");
  React.useEffect(() => {
    let alive = true;
    onLoadHistory(employeeId)
      .then(list => { if (alive) setRuns(list || []); })
      .catch(e => { if (alive) setError(e.message || "Failed to load history"); });
    return () => { alive = false; };
  }, [employeeId]);
  if (error) return <div className="payroll-history" style={{ fontSize: "0.8em", color: "var(--danger, #b00)" }}>{error}</div>;
  if (runs === null) return <div className="payroll-history" style={{ fontSize: "0.8em", opacity: 0.7 }}>Loading payroll history…</div>;
  if (runs.length === 0) return <div className="payroll-history" style={{ fontSize: "0.8em", opacity: 0.7 }}>No payroll runs yet</div>;
  return (
    <div className="payroll-history" style={{ fontSize: "0.8em", opacity: 0.9, paddingLeft: "8px", borderLeft: "2px solid var(--line)" }}>
      {runs.map(run => (
        <div key={run.id}>· {run.periodKey || run.runDate} — gross {amd(run.gross)} · deductions {amd(run.totalDeductions)} · <strong>net {amd(run.net)}</strong></div>
      ))}
    </div>
  );
}

export function PeopleRegistryPanel({ data, onRunPayroll, onUpdate, onLoadHistory, actionState }) {
  const employees = (data && data.employees) || [];
  const activeCount = employees.filter(employee => employee.employmentStatus === "active").length;
  const [editingId, setEditingId] = useState(null);
  const [historyId, setHistoryId] = useState(null);
  return (
    <article className="panel people-registry-panel">
      <div className="panel-head">
        <div><span className="section-label">A1 People</span><h2>Employees</h2></div>
        <strong className="aging-badge">{activeCount} active</strong>
      </div>
      <div className="rows">
        {employees.map(employee => (
          <div className="row" key={employee.id}>
            <span>{employee.fullName} · {employee.position || "—"} · {employee.department || "—"} · <strong>{employee.employmentStatus}</strong> · {amd(employee.grossSalary)}</span>
            <span className="row-actions">
              {onUpdate && (
                <button
                  className="mini-action"
                  type="button"
                  onClick={() => setEditingId(editingId === employee.id ? null : employee.id)}
                >
                  {editingId === employee.id ? "Close" : "Edit"}
                </button>
              )}
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
              {onLoadHistory && (
                <button
                  className="mini-action"
                  type="button"
                  onClick={() => setHistoryId(historyId === employee.id ? null : employee.id)}
                >
                  {historyId === employee.id ? "Hide history" : "Payroll history"}
                </button>
              )}
            </span>
            {onUpdate && editingId === employee.id && (
              <EmployeeEditor employee={employee} onUpdate={onUpdate} actionState={actionState} />
            )}
            {onLoadHistory && historyId === employee.id && (
              <PayrollHistory key={`${employee.id}:${actionState}`} employeeId={employee.id} onLoadHistory={onLoadHistory} />
            )}
          </div>
        ))}
        {employees.length === 0 && <div className="row"><span>No employees yet</span></div>}
      </div>
    </article>
  );
}

export function HrContractsPanel({ employees, onCreate, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [templateCode, setTemplateCode] = useState("permanent");
  const [position, setPosition] = useState("");
  const [startDate, setStartDate] = useState("");
  const [grossSalary, setGrossSalary] = useState("");
  const [endDate, setEndDate] = useState("");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:contract";
  function submit() {
    if (!employeeId || !position.trim() || !startDate) return;
    if (grossSalary && Number.isNaN(Number(grossSalary))) return;
    onCreate({
      employeeId,
      templateCode,
      position: position.trim(),
      startDate,
      endDate: endDate || undefined,
      grossSalary: Math.max(0, Math.round(Number(grossSalary) || 0)),
      idempotencyKey: `ui-ct-${Date.now()}`
    }).then(setResult);
  }
  return (
    <article className="panel hr-contracts-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Աշխատանքային պայմանագիր</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <select value={templateCode} onChange={event => setTemplateCode(event.target.value)}>
          <option value="permanent">Անժամկետ</option>
          <option value="fixed-term">Որոշակի ժամկետ</option>
          <option value="part-time">Մասնակի զբաղվածություն</option>
          <option value="intern">Պրակտիկա</option>
          <option value="remote">Հեռավար</option>
          <option value="secondment">Վերագրում</option>
        </select>
        <input value={position} onChange={event => setPosition(event.target.value)} placeholder="Պաշտոն" />
        <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
        <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} placeholder="Վերջ (ընտրովի)" />
        <input value={grossSalary} onChange={event => setGrossSalary(event.target.value)} inputMode="numeric" placeholder="Աշխատավարձ (AMD)" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Պատրաստվում է" : "Ստեղծել"}</button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>Պայմանագիր #{result.contract.id}՝ <span className="aging-badge">Սևագիր</span></p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.8em" }}>{result.contract.bodyMd.slice(0, 600)}…</pre>
        </div>
      )}
    </article>
  );
}

export function HrLeavePanel({ employees, onRequest, onApprove, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [kind, setKind] = useState("annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:leave";
  function submit() {
    if (!employeeId || !startDate || !endDate) return;
    onRequest({ employeeId, kind, startDate, endDate, reason: reason.trim(), idempotencyKey: `ui-lr-${Date.now()}` }).then(setResult);
  }
  return (
    <article className="panel hr-leave-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Արձակուրդի հայտ</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <select value={kind} onChange={event => setKind(event.target.value)}>
          <option value="annual">Տարեկան հիմնական</option>
          <option value="sick">Հիվանդության</option>
          <option value="unpaid">Անարձակուրդ</option>
        </select>
        <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
        <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} />
        <input value={reason} onChange={event => setReason(event.target.value)} placeholder="Պատճառ" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Ուղարկվում է" : "Հայտ ներկայացնել"}</button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>Հայտ #{result.leaveRequest.id}՝ <span className="aging-badge">{result.leaveRequest.status}</span></p>
          <p>Օրեր՝ <strong>{result.leaveRequest.days}</strong></p>
        </div>
      )}
    </article>
  );
}

export function HrTripsPanel({ employees, onCreate, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [perDiem, setPerDiem] = useState("");
  const [transport, setTransport] = useState("");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:trip";
  function submit() {
    if (!employeeId || !destination || !startDate || !endDate) return;
    onCreate({
      employeeId, destination, startDate, endDate,
      perDiemAmd: Math.max(0, Math.round(Number(perDiem) || 0)),
      transportationAmd: Math.max(0, Math.round(Number(transport) || 0)),
      idempotencyKey: `ui-trip-${Date.now()}`
    }).then(setResult);
  }
  return (
    <article className="panel hr-trips-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Գործուղում</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <input value={destination} onChange={event => setDestination(event.target.value)} placeholder="Վայր" />
        <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
        <input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} />
        <input value={perDiem} onChange={event => setPerDiem(event.target.value)} inputMode="numeric" placeholder="Օրապարգենային (AMD)" />
        <input value={transport} onChange={event => setTransport(event.target.value)} inputMode="numeric" placeholder="Տրանսպորտ (AMD)" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Հաշվարկվում է" : "Ստեղծել"}</button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>Գործուղում #{result.trip.id}՝ ընդհանուր <strong>{result.trip.allowance.total.toLocaleString("hy-AM")} AMD</strong></p>
        </div>
      )}
    </article>
  );
}

export function HrTimesheetPanel({ employees, onSubmit, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [projectId, setProjectId] = useState("p1");
  const [hours, setHours] = useState("8");
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:timesheet";
  function submit() {
    if (!employeeId || !workDate || !hours) return;
    onSubmit({
      employeeId,
      entries: [{ workDate, hours: Number(hours), projectId }],
      idempotencyKey: `ui-ts-${Date.now()}`
    }).then(setResult);
  }
  return (
    <article className="panel hr-timesheet-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Ժամային հաշվետվություն</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <input type="date" value={workDate} onChange={event => setWorkDate(event.target.value)} />
        <input value={hours} onChange={event => setHours(event.target.value)} inputMode="numeric" placeholder="Ժամեր" />
        <input value={projectId} onChange={event => setProjectId(event.target.value)} placeholder="Նախագիծ" />
        <button className="mini-action" type="button" disabled={busy} onClick={submit}>{busy ? "Ուղարկվում է" : "Ավելացնել"}</button>
      </div>
      {result && (
        <div className="copilot-result">
          <p>Ավելացվել է <strong>{result.inserted}</strong> գրառում, ընդհանուր <strong>{result.report.totalHours}</strong> ժամ</p>
        </div>
      )}
    </article>
  );
}

export function HrKpiPanel({ employees, onSetTargets, onSetActuals, onGetScore, actionState }) {
  const [employeeId, setEmployeeId] = useState(employees?.[0]?.id || "");
  const [periodKey, setPeriodKey] = useState(new Date().toISOString().slice(0, 7));
  const [metric, setMetric] = useState("revenue");
  const [target, setTarget] = useState("");
  const [actual, setActual] = useState("");
  const [weight, setWeight] = useState("1");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:kpi";
  function setT() {
    if (!employeeId || !metric || !target) return;
    onSetTargets({ employeeId, periodKey, targets: [{ metric, target: Number(target), weight: Number(weight) }], idempotencyKey: `ui-kpit-${Date.now()}` }).then(setResult);
  }
  function setA() {
    if (!employeeId || !metric || !actual) return;
    onSetActuals({ employeeId, periodKey, actuals: [{ metric, actual: Number(actual) }], idempotencyKey: `ui-kpia-${Date.now()}` }).then(setResult);
  }
  function score() {
    onGetScore({ employeeId, periodKey }).then(setResult);
  }
  return (
    <article className="panel hr-kpi-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>KPI կառավարում</h2></div></div>
      <div className="inline-form">
        <select value={employeeId} onChange={event => setEmployeeId(event.target.value)}>
          {employees?.map(emp => <option key={emp.id} value={emp.id}>{emp.fullName}</option>)}
        </select>
        <input value={periodKey} onChange={event => setPeriodKey(event.target.value)} placeholder="YYYY-MM" />
        <input value={metric} onChange={event => setMetric(event.target.value)} placeholder="Ցուցանիշ" />
        <input value={target} onChange={event => setTarget(event.target.value)} inputMode="numeric" placeholder="Նպատային" />
        <input value={actual} onChange={event => setActual(event.target.value)} inputMode="numeric" placeholder="Փաստացի" />
        <input value={weight} onChange={event => setWeight(event.target.value)} inputMode="numeric" placeholder="Կշիռ" />
        <button className="mini-action" type="button" disabled={busy} onClick={setT}>Նպատակ</button>
        <button className="mini-action" type="button" disabled={busy} onClick={setA}>Փաստացի</button>
        <button className="mini-action" type="button" disabled={busy} onClick={score}>Հաշվել միավորը</button>
      </div>
      {result && (
        <div className="copilot-result">
          {result.score && <p>Կշռված միավոր՝ <strong>{result.score.weighted}</strong></p>}
          {result.targets !== undefined && <p>Նպատակներ պահպանվեցին՝ {result.targets}</p>}
          {result.actuals !== undefined && <p>Փաստացիներ պահպանվեցին՝ {result.actuals}</p>}
        </div>
      )}
    </article>
  );
}

export function HrRecruitmentPanel({ onCreatePipeline, onAddCandidate, actionState }) {
  const [pipelineName, setPipelineName] = useState("Engineering Q3");
  const [stages, setStages] = useState("applied,screen,interview,offer,hired");
  const [pipelineId, setPipelineId] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState("applied");
  const [result, setResult] = useState(null);
  const busy = actionState === "hr:recruit";
  function create() {
    if (!pipelineName) return;
    const stageList = stages.split(",").map(s => s.trim()).filter(Boolean);
    onCreatePipeline({ name: pipelineName, stages: stageList, idempotencyKey: `ui-pipe-${Date.now()}` }).then(r => {
      setResult(r);
      if (r?.pipeline?.id) setPipelineId(r.pipeline.id);
    });
  }
  function add() {
    if (!pipelineId || !fullName) return;
    onAddCandidate({ pipelineId, fullName, email, stage, idempotencyKey: `ui-cand-${Date.now()}` }).then(setResult);
  }
  return (
    <article className="panel hr-recruitment-panel">
      <div className="panel-head"><div><span className="section-label">A1 People / HR</span><h2>Հավաքագրման խողովակ</h2></div></div>
      <div className="inline-form">
        <input value={pipelineName} onChange={event => setPipelineName(event.target.value)} placeholder="Խողովակի անուն" />
        <input value={stages} onChange={event => setStages(event.target.value)} placeholder="Փուլեր (ստորակետով)" />
        <button className="mini-action" type="button" disabled={busy} onClick={create}>Ստեղծել խողովակ</button>
      </div>
      <div className="inline-form">
        <input value={pipelineId} onChange={event => setPipelineId(event.target.value)} placeholder="Խողովակի ID" />
        <input value={fullName} onChange={event => setFullName(event.target.value)} placeholder="Անուն Ազգանուն" />
        <input value={email} onChange={event => setEmail(event.target.value)} placeholder="Էլ. փոստ" />
        <input value={stage} onChange={event => setStage(event.target.value)} placeholder="Փուլ" />
        <button className="mini-action" type="button" disabled={busy} onClick={add}>Ավելացնել թեկնածու</button>
      </div>
      {result && (
        <div className="copilot-result">
          {result.pipeline && <p>Խողովակ #{result.pipeline.id}՝ {result.pipeline.stages.length} փուլ</p>}
          {result.candidate && <p>Թեկնածու #{result.candidate.id}՝ {result.candidate.fullName} ({result.candidate.stage})</p>}
        </div>
      )}
    </article>
  );
}
