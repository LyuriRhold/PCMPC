// Loads every module's registrations (teller items, payor types, member hooks). Import this from
// any entry point that can trigger them: server actions, pages and route handlers that use the
// cashiering registry or change member status.
import "@/modules/cashiering/builtins";
import "@/modules/water/service";
import "@/modules/water/teller";
import "@/modules/water/jobs";
