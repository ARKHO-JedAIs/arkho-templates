import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HomePage } from "@/pages/HomePage";

describe("HomePage", () => {
  it("renders the welcome card from the design system", () => {
    render(<HomePage />);
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });

  it("toggles the theme preference via the Zustand store", async () => {
    const user = userEvent.setup();
    render(<HomePage />);

    expect(screen.getByText("light")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /toggle theme/i }));
    expect(screen.getByText("dark")).toBeInTheDocument();
  });
});
