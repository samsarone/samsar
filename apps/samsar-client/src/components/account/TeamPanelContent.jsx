import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "react-toastify";
import { FaCheck, FaEnvelope, FaSave, FaSync, FaTrash, FaUserPlus } from "react-icons/fa";

import { useColorMode } from "../../contexts/ColorMode.jsx";
import { getHeaders } from "../../utils/web.jsx";

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
}

function getLimitText(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? `${numeric}` : "Unlimited";
}

function getMemberLimitDraft(member = {}) {
  return member.modelApiCallLimit === null || member.modelApiCallLimit === undefined
    ? ""
    : String(member.modelApiCallLimit);
}

export default function TeamPanelContent({ initialStatus = null, onStatusChange = () => {} }) {
  const { colorMode } = useColorMode();
  const isDark = colorMode === "dark";

  const [teamStatus, setTeamStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(!initialStatus);
  const [saving, setSaving] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    username: "",
    email: "",
    modelApiCallLimit: "",
  });
  const [memberDrafts, setMemberDrafts] = useState({});
  const [savingMemberId, setSavingMemberId] = useState(null);

  const textColor = isDark ? "text-slate-100" : "text-slate-900";
  const secondaryTextColor = isDark ? "text-slate-400" : "text-slate-500";
  const cardBgColor = isDark ? "bg-[#0f1629]" : "bg-white";
  const mutedBg = isDark ? "bg-[#0b1224]" : "bg-slate-50";
  const borderColor = isDark ? "border-[#1f2a3d]" : "border-slate-200";
  const inputClass = `min-h-[42px] w-full rounded-lg border ${borderColor} ${isDark ? "bg-[#080f1f] text-slate-100" : "bg-white text-slate-900"} px-3 text-sm outline-none`;
  const iconButtonClass = `inline-flex min-h-[36px] items-center justify-center gap-2 rounded-lg border ${borderColor} px-3 text-xs font-semibold transition ${isDark ? "hover:bg-[#0b1224]" : "hover:bg-slate-100"}`;
  const primaryButtonClass = isDark
    ? "border-cyan-300/35 bg-cyan-400/15 text-cyan-50 hover:bg-cyan-400/25"
    : "border-cyan-200 bg-cyan-50 text-cyan-900 hover:bg-cyan-100";
  const dangerButtonClass = isDark
    ? "border-red-300/35 bg-red-400/10 text-red-100 hover:bg-red-400/20"
    : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100";

  const members = useMemo(() => teamStatus?.members || [], [teamStatus]);
  const invitations = useMemo(() => teamStatus?.invitations || [], [teamStatus]);
  const organizationName = teamStatus?.organizationName || "your organization";

  const syncStatus = (nextStatus) => {
    setTeamStatus(nextStatus);
    onStatusChange(nextStatus);
    const drafts = {};
    (nextStatus?.members || []).forEach((member) => {
      drafts[member.id] = {
        modelApiCallLimit: getMemberLimitDraft(member),
        status: member.status || "active",
      };
    });
    setMemberDrafts(drafts);
  };

  const fetchTeamStatus = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${PROCESSOR_SERVER}/users/team/status`, getHeaders());
      syncStatus(response.data);
    } catch (error) {
      toast.error(error?.response?.data?.error || "Unable to load team settings.", {
        position: "bottom-center",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialStatus) {
      syncStatus(initialStatus);
      return;
    }
    fetchTeamStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enableTeam = async () => {
    setSaving(true);
    try {
      const response = await axios.post(`${PROCESSOR_SERVER}/users/team/enable`, {}, getHeaders());
      syncStatus(response.data);
      toast.success("Team account enabled.", { position: "bottom-center" });
    } catch (error) {
      toast.error(error?.response?.data?.error || "Unable to enable team account.", {
        position: "bottom-center",
      });
    } finally {
      setSaving(false);
    }
  };

  const inviteMember = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        username: inviteForm.username.trim(),
        email: inviteForm.email.trim(),
        modelApiCallLimit: inviteForm.modelApiCallLimit === "" ? null : Number(inviteForm.modelApiCallLimit),
      };
      const response = await axios.post(`${PROCESSOR_SERVER}/users/team/invite`, payload, getHeaders());
      syncStatus({
        ...(teamStatus || {}),
        members: response.data?.members || teamStatus?.members || [],
        invitations: response.data?.invitations || teamStatus?.invitations || [],
      });
      setInviteForm({ username: "", email: "", modelApiCallLimit: "" });
      toast.success("Invitation sent.", { position: "bottom-center" });
    } catch (error) {
      toast.error(error?.response?.data?.error || "Unable to invite team member.", {
        position: "bottom-center",
      });
    } finally {
      setSaving(false);
    }
  };

  const updateDraft = (memberId, field, value) => {
    setMemberDrafts((current) => ({
      ...current,
      [memberId]: {
        ...(current[memberId] || {}),
        [field]: value,
      },
    }));
  };

  const saveMember = async (memberId, options = {}) => {
    const draft = memberDrafts[memberId] || {};
    setSavingMemberId(memberId);
    try {
      const payload = {
        status: draft.status || "active",
        modelApiCallLimit: draft.modelApiCallLimit === "" ? null : Number(draft.modelApiCallLimit),
        ...options,
      };
      const response = await axios.patch(`${PROCESSOR_SERVER}/users/team/members/${memberId}`, payload, getHeaders());
      syncStatus({
        ...(teamStatus || {}),
        members: response.data?.members || teamStatus?.members || [],
        invitations: response.data?.invitations || teamStatus?.invitations || [],
      });
      toast.success("Team member updated.", { position: "bottom-center" });
    } catch (error) {
      toast.error(error?.response?.data?.error || "Unable to update team member.", {
        position: "bottom-center",
      });
    } finally {
      setSavingMemberId(null);
    }
  };

  const revokeInvitation = async (invitationId) => {
    try {
      const response = await axios.delete(`${PROCESSOR_SERVER}/users/team/invitations/${invitationId}`, getHeaders());
      syncStatus({
        ...(teamStatus || {}),
        members: response.data?.members || teamStatus?.members || [],
        invitations: response.data?.invitations || teamStatus?.invitations || [],
      });
      toast.success("Invitation revoked.", { position: "bottom-center" });
    } catch (error) {
      toast.error(error?.response?.data?.error || "Unable to revoke invitation.", {
        position: "bottom-center",
      });
    }
  };

  if (loading) {
    return <p className={secondaryTextColor}>Loading team settings...</p>;
  }

  if (!teamStatus?.canManageTeam) {
    return (
      <div className={`rounded-lg border ${borderColor} ${cardBgColor} p-5 ${textColor}`}>
        <h2 className="text-xl font-semibold">Team</h2>
        <p className={`mt-2 text-sm ${secondaryTextColor}`}>
          Team accounts are available only to the Docker setup admin after an installation address and SMTP or SES mail are configured.
        </p>
      </div>
    );
  }

  return (
    <div className={`mx-auto flex w-full max-w-6xl flex-col gap-5 ${textColor}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Team</h2>
          <p className={`text-sm ${secondaryTextColor}`}>
            Invite members to work inside {organizationName}'s Docker workspace.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchTeamStatus}
          className={`${iconButtonClass} w-full sm:w-auto`}
        >
          <FaSync />
          Refresh
        </button>
      </div>

      <section className={`rounded-lg border ${borderColor} ${cardBgColor} p-4 sm:p-5`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-lg font-semibold">Team account</p>
            <p className={`text-sm ${secondaryTextColor}`}>
              {teamStatus.isTeamAccount
                ? "Enabled. Members create and edit sessions in the owner account."
                : "Enable team access before sending invitations."}
            </p>
          </div>
          {!teamStatus.isTeamAccount && (
            <button
              type="button"
              onClick={enableTeam}
              disabled={saving}
              className={`inline-flex min-h-[42px] w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50 sm:w-auto ${primaryButtonClass}`}
            >
              <FaCheck />
              Enable team
            </button>
          )}
        </div>
      </section>

      {teamStatus.isTeamAccount && (
        <section className={`rounded-lg border ${borderColor} ${cardBgColor} p-4 sm:p-5`}>
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${borderColor} ${mutedBg}`}>
              <FaUserPlus />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold">Invite member</h3>
              <form onSubmit={inviteMember} className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.2fr_0.8fr_auto]">
                <input
                  type="text"
                  value={inviteForm.username}
                  onChange={(event) => setInviteForm((current) => ({ ...current, username: event.target.value }))}
                  className={inputClass}
                  placeholder="Username"
                  required
                />
                <input
                  type="email"
                  value={inviteForm.email}
                  onChange={(event) => setInviteForm((current) => ({ ...current, email: event.target.value }))}
                  className={inputClass}
                  placeholder="member@example.com"
                  required
                />
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={inviteForm.modelApiCallLimit}
                  onChange={(event) => setInviteForm((current) => ({ ...current, modelApiCallLimit: event.target.value }))}
                  className={inputClass}
                  placeholder="Call limit"
                />
                <button
                  type="submit"
                  disabled={saving}
                  className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold disabled:opacity-50 ${primaryButtonClass}`}
                >
                  <FaEnvelope />
                  Invite
                </button>
              </form>
            </div>
          </div>
        </section>
      )}

      <section className={`overflow-hidden rounded-lg border ${borderColor} ${cardBgColor}`}>
        <div className={`border-b ${borderColor} ${mutedBg} px-4 py-3`}>
          <p className="text-lg font-semibold">Members</p>
          <p className={`text-xs ${secondaryTextColor}`}>Limits count model API calls made by each member.</p>
        </div>
        {members.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">No team members yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[900px] text-sm">
              <thead className={mutedBg}>
                <tr>
                  <th className="px-4 py-3 text-left">Member</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Calls</th>
                  <th className="px-4 py-3 text-left">Limit</th>
                  <th className="px-4 py-3 text-left">Last used</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member, index) => (
                  <tr key={member.id} className={`border-t ${borderColor} ${index % 2 === 0 ? mutedBg : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{member.username || member.email}</div>
                      <div className={`text-xs ${secondaryTextColor}`}>{member.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={memberDrafts[member.id]?.status || member.status || "active"}
                        onChange={(event) => updateDraft(member.id, "status", event.target.value)}
                        className={`${inputClass} min-h-[36px] w-32`}
                      >
                        <option value="active">Active</option>
                        <option value="disabled">Disabled</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">{member.modelApiCallCount || 0}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={memberDrafts[member.id]?.modelApiCallLimit ?? ""}
                        onChange={(event) => updateDraft(member.id, "modelApiCallLimit", event.target.value)}
                        className={`${inputClass} min-h-[36px] w-28`}
                        placeholder="Unlimited"
                      />
                    </td>
                    <td className={`px-4 py-3 ${secondaryTextColor}`}>{formatDate(member.lastUsedAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => saveMember(member.id)}
                          disabled={savingMemberId === member.id}
                          className={iconButtonClass}
                        >
                          <FaSave />
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => saveMember(member.id, { resetUsage: true })}
                          disabled={savingMemberId === member.id}
                          className={iconButtonClass}
                        >
                          Reset
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={`overflow-hidden rounded-lg border ${borderColor} ${cardBgColor}`}>
        <div className={`border-b ${borderColor} ${mutedBg} px-4 py-3`}>
          <p className="text-lg font-semibold">Invitations</p>
        </div>
        {invitations.length === 0 ? (
          <div className="p-5 text-sm text-slate-500">No invitations yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[760px] text-sm">
              <thead className={mutedBg}>
                <tr>
                  <th className="px-4 py-3 text-left">Invitee</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Limit</th>
                  <th className="px-4 py-3 text-left">Expires</th>
                  <th className="px-4 py-3 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invitations.map((invitation, index) => (
                  <tr key={invitation.id} className={`border-t ${borderColor} ${index % 2 === 0 ? mutedBg : ""}`}>
                    <td className="px-4 py-3">
                      <div className="font-semibold">{invitation.username || invitation.email}</div>
                      <div className={`text-xs ${secondaryTextColor}`}>{invitation.email}</div>
                    </td>
                    <td className="px-4 py-3">{invitation.status}</td>
                    <td className="px-4 py-3">{getLimitText(invitation.modelApiCallLimit)}</td>
                    <td className={`px-4 py-3 ${secondaryTextColor}`}>{formatDate(invitation.expiresAt)}</td>
                    <td className="px-4 py-3">
                      {invitation.status === "pending" ? (
                        <button
                          type="button"
                          onClick={() => revokeInvitation(invitation.id)}
                          className={`${iconButtonClass} ${dangerButtonClass}`}
                        >
                          <FaTrash />
                          Revoke
                        </button>
                      ) : (
                        <span className={secondaryTextColor}>-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
