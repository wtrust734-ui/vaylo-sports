import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import PBs from "./PBs";

const write = (value: string) => {
  fireEvent.change(screen.getByLabelText(/what was your pb/i), { target: { value } });
};

describe("Personal Bests — one free-text box and a shareable card", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("understands a distance and a clock without asking for units", () => {
    render(<PBs />);
    write("5K in 22:14");

    // The live preview proves the sentence was parsed before saving.
    expect(screen.getByText(/We read/)).toBeInTheDocument();
    expect(screen.getByText("22:14")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save PB" }));

    const card = screen.getByRole("dialog");
    expect(card).toBeInTheDocument();
    expect(screen.getByText("New personal best")).toBeInTheDocument();
    expect(screen.getByText("Share with a friend")).toBeInTheDocument();

    const saved = JSON.parse(localStorage.getItem("vaylo_pbs_v1") ?? "[]");
    expect(saved[0]).toMatchObject({ metric: "5K", value: 1334, unit: "time" });
  });

  it("understands a lift and does not need a unit field", () => {
    render(<PBs />);
    write("bench press 120 kg");
    fireEvent.click(screen.getByRole("button", { name: "Save PB" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText("120 kg").length).toBeGreaterThan(0);
    const saved = JSON.parse(localStorage.getItem("vaylo_pbs_v1") ?? "[]");
    expect(saved[0]).toMatchObject({ metric: "Bench press", value: 120, unit: "kg" });
  });

  it("refuses a slower time instead of overwriting the PB", () => {
    localStorage.setItem("vaylo_pbs_v1", JSON.stringify([{
      id: "one",
      metric: "5K",
      value: 1334,
      unit: "time",
      date: "2026-10-01",
      history: [{ date: "2026-10-01", value: 1334 }],
    }]));

    render(<PBs />);
    write("5K in 24:00");
    fireEvent.click(screen.getByRole("button", { name: "Save PB" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/Not a new best/i);
    const saved = JSON.parse(localStorage.getItem("vaylo_pbs_v1") ?? "[]");
    expect(saved[0].value).toBe(1334);
  });
});
