import { INBOUND_EMAIL_WEBHOOK_URL } from "@/lib/assistant/email-inbound-config"

export function EmailRepliesSetup({ configured }: { configured: boolean }) {
  return (
    <details className="rounded-xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">Email replies into Inbox</summary>
      <div className="mt-3 space-y-3 text-sm text-muted-foreground">
        <p>
          Replies to <span className="text-foreground">sales@zk-sports.com</span> stay in Outlook unless a one-time
          Power Automate flow posts them here. We do not change DNS. Only people we already emailed, or a unique CRM
          contact, land in Inbox — not every sales@ message.
        </p>
        <p className={configured ? "text-foreground" : "text-amber-700"}>
          {configured
            ? "The CRM webhook is ready. Add the Outlook flow below if replies are not appearing yet."
            : "First add ASSISTANT_EMAIL_WEBHOOK_SECRET in Vercel, then create the flow."}
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Open{" "}
            <a
              href="https://make.powerautomate.com"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline"
            >
              make.powerautomate.com
            </a>{" "}
            signed in as whoever owns the sales@ mailbox.
          </li>
          <li>Create → Automated cloud flow. Name it “CRM Inbox email replies”.</li>
          <li>Search for “When a new email arrives (V3)” (Office 365 Outlook). Create.</li>
          <li>Mailbox: sales@zk-sports.com. Folder: Inbox. Save the trigger.</li>
          <li>New step → HTTP. Method POST. (This connector is the paid Power Automate one.)</li>
          <li>
            URI:{" "}
            <code className="break-all rounded bg-muted px-1 py-0.5 text-foreground">{INBOUND_EMAIL_WEBHOOK_URL}</code>
          </li>
          <li>
            Headers: <code className="text-foreground">Content-Type</code> ={" "}
            <code className="text-foreground">application/json</code>, and{" "}
            <code className="text-foreground">x-webhook-secret</code> = the same value as{" "}
            <code className="text-foreground">ASSISTANT_EMAIL_WEBHOOK_SECRET</code> in Vercel.
          </li>
          <li>
            Body (JSON). Use the lightning bolt to pick From, Subject, and Body if you prefer:
            <pre className="mt-1 overflow-x-auto rounded-md bg-muted p-2 text-xs text-foreground">{`{
  "from": "@{triggerOutputs()?['body/from']}",
  "subject": "@{triggerOutputs()?['body/subject']}",
  "text": "@{triggerOutputs()?['body/body']}"
}`}</pre>
          </li>
          <li>Save the flow. Reply to a sequence email from a personal inbox. The reply should open in Sales → Inbox.</li>
        </ol>
      </div>
    </details>
  )
}
