"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { startPatientDemo } from "@/lib/api";

export function DemoButton() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  return (
    <>
      <button className="btn" type="button" onClick={() => {
        try {
          startPatientDemo();
          router.push("/kiosk/bill?demo=1");
        } catch {
          setFailed(true);
        }
      }}>
        Try with fictional data <Icon name="arrowRight" />
      </button>
      {failed && <p role="alert">Enable browser storage to start the demo.</p>}
    </>
  );
}
