/**
 * The gold CareCard, drawn like the 3D-printed card used in the demo. Identifying details are
 * masked so the card reads as one member's card without exposing anyone's number or birth date.
 */
export function GoldCareCard({
  name = "John Doe",
  memberId = "0TC7-XXXX-XXXX",
  dob = "XX-XX-1999",
}: {
  name?: string;
  memberId?: string;
  dob?: string;
}) {
  return (
    <div className="gold-card" role="img" aria-label={`CareCard for ${name}, member ID masked, tap to use`}>
      <div className="gold-card-face">
      <div className="gold-card-inner">
        <div className="gold-card-brand">
          <svg viewBox="0 0 40 32" aria-hidden="true" className="gold-card-mark">
            <rect x="0" y="0" width="17" height="13" rx="4" />
            <rect x="23" y="0" width="17" height="13" rx="4" />
            <rect x="0" y="19" width="17" height="13" rx="4" />
            <rect x="23" y="19" width="17" height="13" rx="4" />
            <rect x="15" y="0" width="10" height="32" rx="1.5" />
            <rect x="0" y="11" width="40" height="10" rx="1.5" />
          </svg>
          <div>
            <strong>
              <span>H</span>EALTH<span>C</span>ARE
            </strong>
            <small>Medicare for all</small>
          </div>
        </div>
        <div className="gold-card-rule" aria-hidden="true">
          <i />
          <span>★ ★ ★ ★ ★</span>
          <i />
        </div>
        <p className="gold-card-name">{name}</p>
        <p className="gold-card-id">{memberId}</p>
        <div className="gold-card-foot">
          <span>DOB {dob}</span>
          <span className="gold-card-tap">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="4" cy="12" r="2" />
              <path d="M9 8.5a5 5 0 0 1 0 7" />
              <path d="M13 6a8.5 8.5 0 0 1 0 12" />
              <path d="M17 3.5a12 12 0 0 1 0 17" />
            </svg>
            Tap to use
          </span>
        </div>
      </div>
      </div>
    </div>
  );
}
