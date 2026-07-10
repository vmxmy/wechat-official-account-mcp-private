import { Field } from '@astryxdesign/core/Field';
import { useId, useRef, type ClipboardEvent, type FocusEvent, type MouseEvent } from 'react';

const VERIFICATION_CODE_LENGTH = 6;

export function VerificationCodeInput({
  value,
  onChange,
  hasAutoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  hasAutoFocus?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputID = useId();
  const descriptionID = `${inputID}-description`;
  const code = normalizeVerificationCode(value);
  const activeIndex = Math.min(code.length, VERIFICATION_CODE_LENGTH - 1);

  function moveCaretToEnd(event: FocusEvent<HTMLInputElement> | MouseEvent<HTMLInputElement>) {
    event.currentTarget.setSelectionRange(code.length, code.length);
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pastedCode = normalizeVerificationCode(event.clipboardData.getData('text'));
    if (!pastedCode) return;

    event.preventDefault();
    onChange(pastedCode);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(pastedCode.length, pastedCode.length);
    });
  }

  return (
    <Field
      label="6 位验证码"
      inputID={inputID}
      description="验证码有效期有限；如未收到，可重新发送。"
      descriptionID={descriptionID}
      isRequired
      width="100%"
    >
      <div className="auth-code-control">
        <input
          ref={inputRef}
          id={inputID}
          className="auth-code-native"
          name="code"
          type="text"
          value={code}
          onChange={event => onChange(normalizeVerificationCode(event.currentTarget.value))}
          onPaste={handlePaste}
          onFocus={moveCaretToEnd}
          onClick={moveCaretToEnd}
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={VERIFICATION_CODE_LENGTH}
          autoComplete="one-time-code"
          enterKeyHint="done"
          aria-describedby={descriptionID}
          autoFocus={hasAutoFocus}
          required
        />
        <div className="auth-code-grid" aria-hidden="true">
          {Array.from({ length: VERIFICATION_CODE_LENGTH }, (_, index) => {
            const digit = code[index] ?? '';
            return (
              <span
                key={index}
                className="auth-code-cell"
                data-active={index === activeIndex}
                data-filled={Boolean(digit)}
              >
                {digit}
              </span>
            );
          })}
        </div>
      </div>
    </Field>
  );
}

function normalizeVerificationCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, VERIFICATION_CODE_LENGTH);
}
