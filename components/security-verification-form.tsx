"use client";

import { useActionState, useState } from "react";
import { recordSecurityVerification } from "@/app/actions/security-verification";
import { AttachmentPicker } from "@/components/attachment-picker";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export function SecurityVerificationForm({ findingId }: { findingId: string }) {
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [state, action, pending] = useActionState(recordSecurityVerification.bind(null, findingId), {});
  return (
    <form action={action} className="mt-4 space-y-3">
      <div>
        <label htmlFor="verification-outcome" className="text-sm font-medium text-zk-text">Outcome</label>
        <Select id="verification-outcome" name="outcome" required defaultValue="">
          <option value="" disabled>Choose an outcome</option>
          <option value="pass">Fix verified</option>
          <option value="fail">Verification failed</option>
          <option value="reopen">Verification failed and reopen the issue</option>
        </Select>
      </div>
      <div>
        <label htmlFor="verification-notes" className="text-sm font-medium text-zk-text">What did you verify?</label>
        <Textarea id="verification-notes" name="notes" required maxLength={4000} rows={4} />
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-zk-text">Verification evidence</legend>
        <p className="text-sm text-zk-text2">Optional. Upload one file. Evidence follows the finding’s visibility.</p>
        <AttachmentPicker name="evidenceId" onChange={setFiles} onUploadingChange={setUploading} disabled={pending} />
        {files.length > 1 ? <p role="alert" className="text-sm text-zk-bad-fg">Keep one evidence file.</p> : null}
      </fieldset>
      {state.error ? <p role="alert" className="text-sm text-zk-bad-fg">{state.error}</p> : null}
      {state.ok ? <p role="status" className="text-sm text-zk-text2">Verification recorded.</p> : null}
      <Button type="submit" disabled={pending || uploading || files.length > 1}>{pending ? "Recording…" : "Record verification"}</Button>
    </form>
  );
}
