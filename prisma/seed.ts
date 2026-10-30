// prisma/seed.ts — Sheggar Wheels demo dataset (SRS Chapter 5 "Data Requirements").
// Idempotent: clears and re-creates. Run: bun prisma/seed.ts (with .env DATABASE_URL set).
import { PrismaClient, Role, CarStatus, Transmission, FuelType, BookingStatus, PaymentStatus, DisputeStatus, UserStatus, DrivingLicenseStatus, DriveMode, LicenseStatus } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { DEMO_ACCOUNT_PASSWORD } from "../src/lib/password-policy";

const db = new PrismaClient();
const FEE_RATE = 0.1; // BR-04 demo platform fee

const d = (iso: string) => new Date(iso + "T00:00:00.000Z");
const days = (s: string, e: string) => Math.round((d(e).getTime() - d(s).getTime()) / 86400000) + 1;
const money = (pricePerDay: number, s: string, e: string, driverFeePerDay = 0) => {
  const n = days(s, e);
  const subtotal = pricePerDay * n;
  const driverTotal = driverFeePerDay * n; // FR-49: owner-driver fee joins the total
  const fee = Math.round((subtotal + driverTotal) * FEE_RATE); // 10% of the OVERALL price
  return { n, subtotal, driverTotal, fee, total: subtotal + driverTotal + fee };
};
const ph = (ids: string[]) => ids.map((id) => `https://images.unsplash.com/photo-${id}?w=900&q=80&auto=format&fit=crop`);
const ref = () => "SW-DEMO-" + Math.random().toString(36).slice(2, 6).toUpperCase();

async function main() {
  await db.notification.deleteMany();
  await db.announcement.deleteMany();
  await db.dispute.deleteMany();
  await db.review.deleteMany();
  await db.booking.deleteMany();
  await db.car.deleteMany();
  await db.user.deleteMany();

  // ── Users ────────────────────────────────────────────────────────────
  // Every seeded account gets the shared demo password (shown on /signin),
  // hashed per user so each row carries its own random scrypt salt.
  const mkUser = (data: { email: string; name: string; phone: string; roles: Role[]; status?: UserStatus; drivingLicenseNumber?: string }) =>
    hashPassword(DEMO_ACCOUNT_PASSWORD).then((passwordHash) =>
      db.user.create({
        data: {
          ...data,
          passwordHash,
          // FR-50: seeded renters arrive with an ADMIN-APPROVED licence so self-drive
          // works out of the box (kalkidan stays NONE to demo the gate).
          ...(data.drivingLicenseNumber
            ? { drivingLicenseNumber: data.drivingLicenseNumber, drivingLicenseStatus: DrivingLicenseStatus.APPROVED }
            : {}),
        },
      })
    );
  const admin = await mkUser({ email: "admin@sheggarwheels.et", name: "Demo Admin", phone: "+251 911 000 001", roles: [Role.ADMIN] });
  const daniel = await mkUser({ email: "daniel@sheggarwheels.et", name: "Daniel Bekele", phone: "+251 911 234 567", roles: [Role.OWNER] });
  const selam = await mkUser({ email: "selam@sheggarwheels.et", name: "Selam Tadesse", phone: "+251 911 345 678", roles: [Role.OWNER] });
  const aklilu = await mkUser({ email: "aklilu@sheggarwheels.et", name: "Aklilu Mengistu", phone: "+251 911 456 789", roles: [Role.OWNER] });
  const yonas = await mkUser({ email: "yonas@sheggarwheels.et", name: "Yonas Girma", phone: "+251 912 111 222", roles: [Role.RENTER], drivingLicenseNumber: "ET-DL-221190" });
  const hanna = await mkUser({ email: "hanna@sheggarwheels.et", name: "Hanna Alemu", phone: "+251 912 222 333", roles: [Role.RENTER], drivingLicenseNumber: "ET-DL-334450" });
  const mert = await mkUser({ email: "mert@sheggarwheels.et", name: "Mert Kebede", phone: "+251 912 333 444", roles: [Role.RENTER], drivingLicenseNumber: "ET-DL-556780" });
  const ruth = await mkUser({ email: "ruth@sheggarwheels.et", name: "Ruth Wolde", phone: "+251 912 444 555", roles: [Role.RENTER, Role.OWNER], drivingLicenseNumber: "ET-DL-667890" });
  await mkUser({ email: "kalkidan@sheggarwheels.et", name: "Kalkidan Assefa", phone: "+251 912 555 666", roles: [Role.RENTER], status: UserStatus.SUSPENDED });

  // ── Cars (Addis Ababa neighbourhoods; coords are seeded sample points, C7) ──
  const cars = await Promise.all([
    db.car.create({ data: { ownerId: daniel.id, make: "Toyota", model: "Vitz", year: 2019, transmission: Transmission.MANUAL, fuelType: FuelType.PETROL, seats: 5, neighbourhood: "Bole", lat: 8.9936, lng: 38.7871, pricePerDay: 2800, description: "Fuel-saving city hatchback, perfect for Addis traffic. Well maintained, clean interior, AC works perfectly.", photos: ph(["1606664515524-ed2f786a0bd6", "1503376780353-7e6692767b70", "1511919884226-fd3cad34687c"]), status: CarStatus.APPROVED } }),
    db.car.create({ data: { ownerId: daniel.id, make: "Toyota", model: "Corolla", year: 2021, transmission: Transmission.AUTOMATIC, fuelType: FuelType.HYBRID, seats: 5, neighbourhood: "Kazanchis", lat: 9.0156, lng: 38.7608, pricePerDay: 3800, description: "Comfortable automatic sedan for business trips and family weekends. Large boot, very economical.", photos: ph(["1549317661-bd32c8ce0db2", "1502877338535-766e1452684a"]), status: CarStatus.APPROVED, driverFeePerDay: 900 } }),
    db.car.create({ data: { ownerId: daniel.id, make: "Toyota", model: "RAV4", year: 2020, transmission: Transmission.AUTOMATIC, fuelType: FuelType.HYBRID, seats: 5, neighbourhood: "Old Airport", lat: 8.9867, lng: 38.7997, pricePerDay: 5200, description: "Reliable SUV for weekend escapes to Debre Zeit or Entoto. AWD, spacious, roof rails.", photos: ph(["1568605117036-5fe5e7bab0b7", "1519641471654-76ce0107ad1b"]), status: CarStatus.APPROVED, unavailableDates: [d("2026-11-10"), d("2026-11-11"), d("2026-11-12")] } }),
    db.car.create({ data: { ownerId: selam.id, make: "Suzuki", model: "Dzire", year: 2022, transmission: Transmission.MANUAL, fuelType: FuelType.PETROL, seats: 4, neighbourhood: "Gerji", lat: 9.0068, lng: 38.8117, pricePerDay: 2600, description: "Brand-new compact sedan. Cheapest way to run errands or commute across town.", photos: ph(["1541899481282-d53bffe3c35d", "1494976388531-d1058494cdd8"]), status: CarStatus.APPROVED } }),
    db.car.create({ data: { ownerId: selam.id, make: "Hyundai", model: "Tucson", year: 2021, transmission: Transmission.AUTOMATIC, fuelType: FuelType.DIESEL, seats: 5, neighbourhood: "CMC", lat: 9.0269, lng: 38.8305, pricePerDay: 5500, description: "Premium compact SUV with reverse camera and cruise control. Great for longer trips.", photos: ph(["1605559424843-9e4c228bf1c2", "1533473359331-0135ef1b58bf"]), status: CarStatus.APPROVED, unavailableDates: [d("2026-12-01")] } }),
    db.car.create({ data: { ownerId: selam.id, make: "Toyota", model: "Hilux", year: 2018, transmission: Transmission.MANUAL, fuelType: FuelType.DIESEL, seats: 5, neighbourhood: "Saris", lat: 8.9708, lng: 38.7469, pricePerDay: 4800, description: "Double-cab pickup for deliveries, construction sites, and road trips outside Addis.", photos: ph(["1571607388263-1044f9ea01dd"]), status: CarStatus.APPROVED, unavailableDates: [d("2026-10-30"), d("2026-10-31"), d("2026-11-01")] } }),
    db.car.create({ data: { ownerId: aklilu.id, make: "Volkswagen", model: "Polo", year: 2020, transmission: Transmission.MANUAL, fuelType: FuelType.PETROL, seats: 5, neighbourhood: "Megenagna", lat: 9.0186, lng: 38.8026, pricePerDay: 3200, description: "Solid German hatchback with excellent brakes and handling for city hills.", photos: ph(["1550355291-bbee04a92027"]), status: CarStatus.APPROVED } }),
    db.car.create({ data: { ownerId: aklilu.id, make: "Hyundai", model: "Accent", year: 2019, transmission: Transmission.AUTOMATIC, fuelType: FuelType.PETROL, seats: 5, neighbourhood: "Bole", lat: 8.9881, lng: 38.7906, pricePerDay: 3400, description: "Smooth automatic sedan, ideal for airport pickups and drop-offs.", photos: ph(["1583121274602-3e2820c69888"]), status: CarStatus.APPROVED } }),
    db.car.create({ data: { ownerId: aklilu.id, make: "Lexus", model: "RX 350", year: 2017, transmission: Transmission.AUTOMATIC, fuelType: FuelType.PETROL, seats: 5, neighbourhood: "Bole", lat: 8.9921, lng: 38.7829, pricePerDay: 7500, description: "Luxury SUV for weddings, VIP transport, and special occasions.", photos: ph(["1552519507-da3b142c6e3d"]), status: CarStatus.APPROVED, driverFeePerDay: 1500 } }),
    db.car.create({ data: { ownerId: daniel.id, make: "Toyota", model: "Land Cruiser", year: 2016, transmission: Transmission.AUTOMATIC, fuelType: FuelType.DIESEL, seats: 7, neighbourhood: "Bole", lat: 9.0011, lng: 38.7796, pricePerDay: 6800, description: "Seven-seat 4x4 for group trips and rough roads. Awaiting admin approval.", photos: ph(["1544620347-c4fd1a88d917"]), status: CarStatus.PENDING } }),
    db.car.create({ data: { ownerId: selam.id, make: "Lifan", model: "Myway", year: 2018, transmission: Transmission.MANUAL, fuelType: FuelType.PETROL, seats: 5, neighbourhood: "Kality", lat: 8.9502, lng: 38.7749, pricePerDay: 2400, description: "Budget SUV, needs bodywork on the left door. Listed for transparency.", photos: ph(["1542362567-b07e54358753"]), status: CarStatus.REJECTED } }),
    // FR-32 v2: an electric category car so the fuel filter has a real hit.
    db.car.create({ data: { ownerId: selam.id, make: "BYD", model: "Atto 3", year: 2023, transmission: Transmission.AUTOMATIC, fuelType: FuelType.ELECTRIC, seats: 5, neighbourhood: "Bole", lat: 8.9949, lng: 38.7902, pricePerDay: 6500, description: "Fully electric crossover with 420 km range — zero fuel cost. Charge overnight at home or at the Bole fast-charging station. Silent ride, instant torque, rotating screen.", photos: ph(["1503376780353-7e6692767b70", "1560958089-a83b46b49279"]), status: CarStatus.APPROVED } }),
  ]);
  const [vitz, corolla, rav4, dzire, tucson, hilux, polo, accent, lexus, landcruiser] = cars;

  // ── Bookings across the lifecycle (BR-03/04/05 maths; fee 10%) ────────
  const payMethods = ["TeleBirr", "Chapa", "CBE Birr", "M-Pesa"]; // rotate for variety
  let pmIdx = 0;
  const mk = async (
    car: { id: string; pricePerDay: number }, renterId: string, ownerId: string, s: string, e: string,
    status: BookingStatus, pay: PaymentStatus, withRef = false,
    extra: { driveMode?: DriveMode; driverName?: string; driverFeePerDay?: number } = {}
  ) => {
    const m = money(car.pricePerDay, s, e, extra.driverFeePerDay ?? 0);
    return db.booking.create({ data: {
      carId: car.id, renterId, ownerId, startDate: d(s), endDate: d(e), days: m.n, pricePerDay: car.pricePerDay,
      subtotal: m.subtotal, fee: m.fee, total: m.total,
      // FR-49 snapshots: drive mode + frozen driver fee (0 unless OWNER_DRIVER).
      driveMode: extra.driveMode ?? DriveMode.SELF_DRIVE,
      ...(extra.driverName ? { driverName: extra.driverName } : {}),
      driverFeePerDay: extra.driverFeePerDay ?? 0, driverTotal: m.driverTotal,
      // Licence semantics: OWN_DRIVER requests start PENDING (owner reviews the
      // driver's licence); everything else is admin/owner-covered → APPROVED.
      licenseStatus: extra.driveMode === DriveMode.OWN_DRIVER ? LicenseStatus.PENDING : LicenseStatus.APPROVED,
      ...(extra.driveMode === DriveMode.OWN_DRIVER ? { licenseNumber: "ET-DM-778120" } : {}),
      status, paymentStatus: pay, paymentRef: withRef ? ref() : null, paymentMethod: withRef ? payMethods[pmIdx++ % payMethods.length] : null,
      ...(status === BookingStatus.DISPUTED ? { statusBeforeDispute: BookingStatus.COMPLETED } : {}),
    } });
  };
  const b1 = await mk(vitz, yonas.id, daniel.id, "2026-07-12", "2026-07-15", BookingStatus.COMPLETED, PaymentStatus.PAID, true);
  const b2 = await mk(corolla, hanna.id, daniel.id, "2026-08-02", "2026-08-03", BookingStatus.COMPLETED, PaymentStatus.PAID, true);
  const b3 = await mk(rav4, mert.id, daniel.id, "2026-10-22", "2026-10-25", BookingStatus.CONFIRMED, PaymentStatus.HELD, true, { driveMode: DriveMode.OWNER_DRIVER, driverFeePerDay: 1000 }); // owner-driver trip
  const b4 = await mk(vitz, hanna.id, daniel.id, "2026-10-21", "2026-10-22", BookingStatus.REQUESTED, PaymentStatus.UNPAID, false, { driveMode: DriveMode.OWN_DRIVER, driverName: "Bekele Ayana" }); // own driver — licence pending owner review
  const b5 = await mk(corolla, ruth.id, daniel.id, "2026-11-03", "2026-11-05", BookingStatus.REQUESTED, PaymentStatus.UNPAID);
  const b6 = await mk(corolla, yonas.id, daniel.id, "2026-11-04", "2026-11-06", BookingStatus.REQUESTED, PaymentStatus.UNPAID); // overlaps b5 → BR-05 live demo
  const b7 = await mk(dzire, mert.id, selam.id, "2026-09-20", "2026-09-22", BookingStatus.COMPLETED, PaymentStatus.PAID, true);
  const b8 = await mk(tucson, yonas.id, selam.id, "2026-10-19", "2026-10-26", BookingStatus.IN_PROGRESS, PaymentStatus.HELD, true);
  const b9 = await mk(hilux, ruth.id, selam.id, "2026-08-28", "2026-08-30", BookingStatus.DECLINED, PaymentStatus.UNPAID);
  const b10 = await mk(polo, hanna.id, aklilu.id, "2026-06-14", "2026-06-17", BookingStatus.COMPLETED, PaymentStatus.PAID, true);
  const b11 = await mk(accent, mert.id, aklilu.id, "2026-10-05", "2026-10-07", BookingStatus.CANCELLED, PaymentStatus.REFUNDED, true);
  const b12 = await mk(lexus, yonas.id, aklilu.id, "2026-10-08", "2026-10-10", BookingStatus.DISPUTED, PaymentStatus.PAID, true);
  const b13 = await mk(landcruiser, ruth.id, selam.id, "2026-05-01", "2026-05-04", BookingStatus.RESOLVED, PaymentStatus.PAID, true);

  // ── Reviews (BR-06) + one owner reply (FR-31) ─────────────────────────
  const rv = (b: { id: string }, car: { id: string }, renterId: string, ownerId: string, rating: number, comment: string, reply?: string) =>
    db.review.create({ data: { bookingId: b.id, carId: car.id, renterId, ownerId, rating, comment, ownerReply: reply, repliedAt: reply ? new Date() : null } });
  await rv(b1, vitz, yonas.id, daniel.id, 5, "The Vitz was spotless and Daniel met me right on time near Bole. Fuel economy is unbeatable for city errands.", "Thank you Yonas — you left it spotless too. Always welcome!");
  await rv(b2, corolla, hanna.id, daniel.id, 4, "Smooth pickup, car exactly as listed. Would have liked a second key, but the trip itself was perfect.");
  await rv(b7, dzire, mert.id, selam.id, 5, "Cheapest, easiest rental I have done in Addis. Selam's instructions were crystal clear.");
  await rv(b10, polo, hanna.id, aklilu.id, 3, "Good value and solid handling, but the AC was weak in the afternoon heat.", "Sorry Hanna — the AC is now re-gassed and tested. Thank you for the honest feedback.");
  await rv(b13, landcruiser, ruth.id, selam.id, 4, "The Land Cruiser handled the Mojo road like a champ. A few scuffs inside but nothing serious.");

  // ── Disputes (BR-07, FR-43) ───────────────────────────────────────────
  await db.dispute.create({ data: { bookingId: b12.id, openedById: yonas.id, reason: "I returned the Lexus 40 minutes early, but I was still charged for a full extra day. Requesting a refund of the difference.", status: DisputeStatus.OPEN } });
  await db.dispute.create({ data: { bookingId: b13.id, openedById: selam.id, reason: "Renter reported a pre-existing scratch near the right rear wheel as new damage.", status: DisputeStatus.RESOLVED, resolutionNotes: "Checked handover photos — the scratch was recorded at pickup. No charge; booking resolved and closed.", resolvedById: admin.id, resolvedAt: new Date() } });

  // ── Announcements + Notifications (FR-44..46, BR-12) ──────────────────
  await db.announcement.create({ data: { title: "Welcome to Sheggar Wheels (Demo)", body: "This platform is a capstone demonstration. All payments are mock TeleBirr transactions and money is labelled as held until the trip completes. Cars and users are seeded demo data.", active: true, createdById: admin.id } });
  // Owner-submitted events & discounts — approved ones are live on the home
  // banner; the last one is still awaiting admin approval (BR-02 gate, 3rd door).
  await db.announcement.createMany({ data: [
    { title: "Addis Auto Expo — free test-drives", body: "Meet Sheggar Wheels owners at Meskel Square on 15 Nov. Five cars available for supervised test-drives around the circuit, 10:00-17:00.", kind: "EVENT", active: true, createdById: daniel.id, validUntil: d("2026-11-16") },
    // Each DISCOUNT targets one car: badge on its card + maths applied to its bookings.
    { title: "Weekend flash: 15% off the Tucson", body: "Rules: 15% off Selam's Hyundai Tucson. Minimum 2 rental days, weekend pickup only. Cannot be combined with other offers.", kind: "DISCOUNT", discountPercent: 15, carId: cars[4].id, active: true, createdById: selam.id, validUntil: d("2026-11-30") },
    { title: "First-trip promo: 10% off the Vitz", body: "Rules: 10% off Daniel's Toyota Vitz in Bole. One discount per booking; applies at request time and is frozen into your booking (BR-03).", kind: "DISCOUNT", discountPercent: 10, carId: cars[0].id, active: true, createdById: daniel.id, validUntil: d("2026-12-31") },
    { title: "Rainy-season sale: 20% off the Polo", body: "Rules: 20% off Aklilu's Volkswagen Polo on weekday pickups. One discount per booking.", kind: "DISCOUNT", discountPercent: 20, carId: cars[6].id, active: false, createdById: aklilu.id, validUntil: d("2026-12-15") },
  ] });
  await db.notification.createMany({ data: [
    { userId: daniel.id, title: "New booking request", body: "Hanna Alemu requested your Toyota Vitz for 21-22 Oct.", link: "/owner/cars/" + vitz.id + "/bookings" },
    { userId: daniel.id, title: "Payment held in escrow", body: "Mert Kebede's payment of ETB 22,880 is held until the RAV4 trip completes.", link: "/bookings" },
    { userId: daniel.id, title: "New review on your Vitz", body: "Yonas Girma left a 5-star review.", link: "/owner/reviews", read: true },
    { userId: mert.id, title: "Your trip starts soon", body: "RAV4 pickup is on 22 Oct at Old Airport. Payment is safely held.", link: "/bookings/" + b3.id },
    { userId: yonas.id, title: "Trip in progress", body: "Enjoy the Hyundai Tucson! Mark the trip complete at return.", link: "/bookings/" + b8.id },
    { userId: hanna.id, title: "Booking request sent", body: "Your request for the Toyota Vitz was sent to Daniel Bekele.", link: "/bookings/" + b4.id },
    { userId: admin.id, title: "New dispute opened", body: "A trip on the Lexus RX 350 needs review.", link: "/admin/disputes" },
  ] });

  console.log("Seeded:", { users: 9, cars: cars.length, bookings: 13, reviews: 5, disputes: 2 });
  console.log("Drive modes (FR-49): b3 OWNER_DRIVER (+ETB 1000/day), b4 OWN_DRIVER (licence pending review); renters have admin-approved licences (FR-50). Corolla +ETB 900/day, Lexus +ETB 1500/day.");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
