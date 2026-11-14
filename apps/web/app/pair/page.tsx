import { PairDevice } from "./PairDevice";

export const metadata = { title: "Set up device" };

// Staff screen: pair a kiosk, provider terminal or caseworker device (POST /api/devices/pair).
export default function PairPage() {
  return <PairDevice />;
}
