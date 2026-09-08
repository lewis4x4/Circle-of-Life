import { createRoot } from "react-dom/client";
import EmployeeFileClient from "../../src/components/staff/EmployeeFileClient";
import "../../src/app/globals.css";

createRoot(document.getElementById("root")!).render(<EmployeeFileClient staffId="11111111-1111-4111-8111-111111111111" />);
