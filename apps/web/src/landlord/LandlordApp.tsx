import { useMemo, useState, type FormEvent } from "react";
import { Building2, LogOut } from "lucide-react";
import { api, type Bill as ApiBill, type User } from "../api.js";
import { firstName } from "../lib/format.js";
import { messageOf } from "../lib/model.js";
import { ChargeMeshBrand } from "../components/Brand.js";
import { ThemeToggle } from "../components/ThemeToggle.js";
import { CreVerificationPanel } from "../components/CreVerificationPanel.js";
import {
  Alert,
  Loading,
  PrimaryButton,
  cardClass,
  inputClass,
  labelClass
} from "../components/ui.js";
import { useLandlordData } from "./useLandlordData.js";
import { buildStudioWorkspace } from "./adapter.js";
import { Navbar, type NavTab } from "./Navbar.js";
import { Footer } from "./Footer.js";
import { OverviewView } from "./OverviewView.js";
import { RoomsRentersView } from "./RoomsRentersView.js";
import { BillsView } from "./BillsView.js";
import { MeterReadingsView } from "./MeterReadingsView.js";
import { DisputesView } from "./DisputesView.js";
import { SettingsView } from "./SettingsView.js";
import { TariffModal } from "./TariffModal.js";
import { CreateBillModal } from "./CreateBillModal.js";
import { AddRoomModal, type NewRoomInput } from "./AddRoomModal.js";
import type { PropertySettings } from "./types.js";

export type LandlordTab = NavTab;

export function LandlordApp({
  user,
  onLogout,
  onUserChange
}: {
  user: User;
  onLogout: () => void;
  onUserChange: (user: User) => void;
}) {
  const data = useLandlordData();
  const [tab, setTab] = useState<LandlordTab>("overview");
  const [tariffOpen, setTariffOpen] = useState(false);
  const [createBillOpen, setCreateBillOpen] = useState(false);
  const [createBillRoomId, setCreateBillRoomId] = useState<string | undefined>();
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [assignRoomUnit, setAssignRoomUnit] = useState<string | undefined>();

  const workspace = useMemo(() => {
    if (!data.property) return null;
    return buildStudioWorkspace({
      rooms: data.rooms,
      bills: data.bills,
      disputes: data.disputes,
      property: data.property,
      user,
      rate: data.propertyRate
    });
  }, [data.rooms, data.bills, data.disputes, data.property, data.propertyRate, user]);

  if (data.loading) return <Loading />;

  if (!data.property || !workspace) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans antialiased">
        <header className="bg-white border-b border-slate-200/80 sticky top-0 z-30">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-18 flex items-center justify-between gap-3">
            <ChargeMeshBrand subtitle="Electricity & Rent Billing" className="select-none min-w-0" />
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">
              <div className="hidden sm:block text-right">
                <div className="text-sm font-semibold text-slate-800 leading-tight">{user.name}</div>
                <div className="text-xs text-slate-500 font-medium">Landlord</div>
              </div>
              <ThemeToggle />
              <button
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Log out</span>
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-10">
          {data.error && <Alert kind="error">{data.error}</Alert>}
          <CreatePropertyCard userName={user.name} onCreated={data.reload} />
        </main>

        <Footer onRefresh={() => void data.reload()} />
      </div>
    );
  }

  const property = data.property;
  const settings = workspace.settings;
  const openDisputes = workspace.disputes.length;
  const selectedBill =
    workspace.bills.find((bill) => bill.id === selectedBillId) ?? null;

  const handleUpdateTariff = async (rate: number) => {
    await api.updateProperty(property.id, { defaultRateNprPerKwh: rate });
    for (const room of data.rooms) {
      await api.createTariff(room.id, rate);
    }
    await data.reload();
  };

  const handleUpdateSettings = async (next: PropertySettings) => {
    await api.updateProperty(property.id, {
      name: next.propertyName.trim(),
      address: next.address.trim(),
      billingCycle: next.billingCycle.trim(),
      landlordTitle: next.landlordRole.trim(),
      defaultRateNprPerKwh: next.electricityRateNpr
    });

    const name = next.landlordName.trim();
    if (name && name !== user.name) {
      const updated = await api.updateMyName(name);
      onUserChange(updated.user);
    }

    if (next.electricityRateNpr !== data.propertyRate) {
      for (const room of data.rooms) {
        await api.createTariff(room.id, next.electricityRateNpr);
      }
    }

    await data.reload();
  };

  const handleAddRoom = async (input: NewRoomInput) => {
    try {
      const { room } = await api.createRoom({
        propertyId: property.id,
        name: input.unitNumber,
        floor: input.floor,
        unitType: input.type
      });
      await api.createTariff(room.id, input.rate);
      await api.createMeter(room.id, input.meterId);
      if (input.renterEmail) {
        await api.assignRenter(room.id, input.renterEmail);
      }
    } finally {
      await data.reload();
    }
  };

  const handleAssignRenter = async (roomId: string, _name: string, email: string) => {
    await api.assignRenter(roomId, email);
    await data.reload();
  };

  const handleRemoveRenter = async (roomId: string) => {
    const room = data.rooms.find((candidate) => candidate.id === roomId);
    const tenancyId = room?.renter?.tenancyId;
    if (!tenancyId) {
      throw new Error("This room has no active tenancy to end.");
    }
    await api.endTenancy(tenancyId);
    await data.reload();
  };

  const handleQuickBill = async (roomId: string) => {
    const suggestion = await api.billSuggestion(roomId);
    const { bill } = await api.createBill({
      roomId,
      periodStart: suggestion.periodStart,
      periodEnd: suggestion.periodEnd
    });
    await data.reload();
    setSelectedBillId(bill.billId);
  };

  const handleCreateBill = async (bill: ApiBill) => {
    await data.reload();
    setCreateBillOpen(false);
    setSelectedBillId(bill.billId);
    setTab("bills");
  };

  const handleSendBill = async (billId: string) => {
    await api.issueBill(billId);
    await data.reload();
  };

  const handleMarkPaid = async (billId: string) => {
    await api.markBillPaid(billId);
    await data.reload();
  };

  const handleVerifyPayment = async (billId: string) => {
    await api.verifyBillPayment(billId);
    await data.reload();
  };

  const handleDeleteBill = async (billId: string) => {
    await api.deleteBill(billId);
    await data.reload();
    setSelectedBillId(null);
  };

  const handleResolveDispute = async (
    disputeId: string,
    resolutionType: "bill_correct" | "courtesy_discount",
    customMessage: string
  ) => {
    if (resolutionType === "courtesy_discount") {
      const dispute = workspace.disputes.find((item) => item.id === disputeId);
      await api.resolveDispute(disputeId, {
        status: "upheld",
        resolution: customMessage,
        creditNpr: dispute?.appliedDiscountNpr
      });
    } else {
      await api.resolveDispute(disputeId, {
        status: "rejected",
        resolution: customMessage
      });
    }
    await data.reload();
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans antialiased">
      <Navbar
        activeTab={tab}
        onSelectTab={setTab}
        openDisputeCount={openDisputes}
        settings={settings}
        onOpenTariffModal={() => setTariffOpen(true)}
        onSwitchPortal={onLogout}
        onLogout={onLogout}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
        {data.properties.length > 1 && (
          <div className="flex items-center gap-2 text-xs">
            <Building2 className="w-4 h-4 text-slate-400" />
            <span className="text-slate-500 font-medium">Property:</span>
            <select
              value={property.id}
              onChange={(event) => data.selectProperty(event.target.value)}
              className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800"
            >
              {data.properties.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {data.error && <Alert kind="error">Could not refresh data: {data.error}</Alert>}

        {tab === "overview" && (
          <OverviewView
            rooms={workspace.rooms}
            bills={workspace.bills}
            openDisputeCount={openDisputes}
            settings={settings}
            onNavigate={setTab}
            onOpenCreateBill={() => {
              setCreateBillRoomId(undefined);
              setCreateBillOpen(true);
            }}
            onOpenTariffModal={() => setTariffOpen(true)}
            onAssignRenterPrompt={(roomUnit) => {
              setAssignRoomUnit(roomUnit);
              setTab("rooms");
            }}
          />
        )}

        {tab === "rooms" && (
          <RoomsRentersView
            rooms={workspace.rooms}
            settings={settings}
            onOpenAddRoom={() => setAddRoomOpen(true)}
            onOpenCreateBillForRoom={(room) => {
              setCreateBillRoomId(room.id);
              setCreateBillOpen(true);
            }}
            onAssignRenter={handleAssignRenter}
            onRemoveRenter={handleRemoveRenter}
            initialAssignRoomUnit={assignRoomUnit}
          />
        )}

        {tab === "bills" && (
          <BillsView
            bills={workspace.bills}
            rooms={workspace.rooms}
            settings={settings}
            selectedBill={selectedBill}
            onSelectBill={(bill) => setSelectedBillId(bill?.id ?? null)}
            onOpenCreateModal={() => {
              setCreateBillRoomId(undefined);
              setCreateBillOpen(true);
            }}
            onSendBill={handleSendBill}
            onMarkPaid={handleMarkPaid}
            onVerifyPayment={handleVerifyPayment}
            onDeleteBill={handleDeleteBill}
            onCreateQuickBill={handleQuickBill}
            landlordWallets={workspace?.wallets || []}
          />
        )}

        {tab === "readings" && (
          <div className="space-y-6">
            <MeterReadingsView rooms={workspace.rooms} />
            <CreVerificationPanel reports={data.creReports} />
          </div>
        )}

        {tab === "disputes" && (
          <DisputesView
            disputes={workspace.disputes}
            resolvedInquiries={workspace.resolvedInquiries}
            onResolveDispute={handleResolveDispute}
          />
        )}

        {tab === "settings" && (
          <SettingsView
            settings={settings}
            userId={user.id}
            onUpdateSettings={handleUpdateSettings}
            onVerifyAudit={api.verifyAudit}
          />
        )}
      </main>

      <Footer onRefresh={() => void data.reload()} />

      <TariffModal
        isOpen={tariffOpen}
        onClose={() => setTariffOpen(false)}
        currentRate={settings.electricityRateNpr}
        onSave={handleUpdateTariff}
      />

      <CreateBillModal
        isOpen={createBillOpen}
        onClose={() => setCreateBillOpen(false)}
        rooms={workspace.rooms}
        currentTariff={settings.electricityRateNpr}
        initialRoomId={createBillRoomId}
        onCreated={handleCreateBill}
      />

      <AddRoomModal
        isOpen={addRoomOpen}
        onClose={() => setAddRoomOpen(false)}
        onAddRoom={handleAddRoom}
        existingCount={workspace.rooms.length}
        currentRate={settings.electricityRateNpr}
      />
    </div>
  );
}

function CreatePropertyCard({
  userName,
  onCreated
}: {
  userName: string;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [rate, setRate] = useState("12.50");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.createProperty({
        name: name.trim(),
        address: address.trim() || undefined,
        defaultRateNprPerKwh: Number(rate)
      });
      await onCreated();
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <div className={`${cardClass} p-6 max-w-xl`}>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">
        Welcome, {firstName(userName)}
      </h1>
      <p className="text-sm text-slate-500 mt-1">
        Start by adding the building you rent out. You can add rooms and meters next.
      </p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className={labelClass} htmlFor="pname">
            Property / building name *
          </label>
          <input
            id="pname"
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="e.g. Alpine Heights"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="paddr">
            Address
          </label>
          <input
            id="paddr"
            className={inputClass}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="e.g. Baneshwor, Kathmandu"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="prate">
            Electricity rate for new rooms (USD per kWh) *
          </label>
          <input
            id="prate"
            type="number"
            min="0.01"
            step="0.01"
            className={inputClass}
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            required
          />
        </div>
        {error && <Alert kind="error">{error}</Alert>}
        <PrimaryButton type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create property"}
        </PrimaryButton>
      </form>
    </div>
  );
}
