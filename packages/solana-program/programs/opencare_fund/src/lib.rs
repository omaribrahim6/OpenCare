//! OpenCare community fund rules, enforced on Solana devnet.
//!
//! The dollars live in Capital One Nessie. This program decides what the fund is allowed to pay and
//! keeps a public, permanent record of it:
//! - `Config` holds the fund's published rules: the largest grant and a hash of the rules text.
//! - `Hospital` is an attestation that a wallet belongs to a verified hospital, linked to the hash of
//!   its Nessie merchant ID. Grants can only name an attested, active hospital.
//! - `Grant` is created once per case (seeded by the case's opaque reference hash), so the same case
//!   can never be approved twice. `mark_paid` then records the hash of the Nessie payment that paid it.
//!
//! No patient data goes on chain: only opaque hashes, amounts and hospital wallets.

use anchor_lang::prelude::*;

declare_id!("Gj8AgKfuH1u546FCNMhwAp32ExxNcXCuU5EtdeMBLbmn");

pub const CONFIG_SEED: &[u8] = b"config";
pub const HOSPITAL_SEED: &[u8] = b"hospital";
pub const GRANT_SEED: &[u8] = b"grant";

#[program]
pub mod opencare_fund {
    use super::*;

    /// One-time setup. The signer becomes the fund's authority (the caseworker desk's key).
    pub fn initialize(ctx: Context<Initialize>, max_grant_cents: u64, rules_hash: [u8; 32]) -> Result<()> {
        require!(max_grant_cents > 0, FundError::InvalidAmount);
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.max_grant_cents = max_grant_cents;
        config.rules_hash = rules_hash;
        config.rules_version = 1;
        config.grants_approved = 0;
        config.grants_declined = 0;
        config.cents_approved = 0;
        config.cents_paid = 0;
        config.bump = ctx.bumps.config;
        emit!(RulesSet { max_grant_cents, rules_hash, rules_version: 1 });
        Ok(())
    }

    /// Publish a new version of the fund's rules.
    pub fn set_rules(ctx: Context<AuthorityOnly>, max_grant_cents: u64, rules_hash: [u8; 32]) -> Result<()> {
        require!(max_grant_cents > 0, FundError::InvalidAmount);
        let config = &mut ctx.accounts.config;
        config.max_grant_cents = max_grant_cents;
        config.rules_hash = rules_hash;
        config.rules_version = config.rules_version.checked_add(1).ok_or(FundError::Overflow)?;
        emit!(RulesSet { max_grant_cents, rules_hash, rules_version: config.rules_version });
        Ok(())
    }

    /// Attest that `wallet` is a verified hospital whose Nessie merchant ID hashes to `merchant_hash`.
    pub fn attest_hospital(ctx: Context<AttestHospital>, merchant_hash: [u8; 32]) -> Result<()> {
        let hospital = &mut ctx.accounts.hospital;
        hospital.wallet = ctx.accounts.wallet.key();
        hospital.merchant_hash = merchant_hash;
        hospital.active = true;
        hospital.attested_at = Clock::get()?.unix_timestamp;
        hospital.bump = ctx.bumps.hospital;
        emit!(HospitalAttested { wallet: hospital.wallet, merchant_hash, active: true });
        Ok(())
    }

    /// Withdraw or restore a hospital's attestation.
    pub fn set_hospital_active(ctx: Context<SetHospitalActive>, active: bool) -> Result<()> {
        let hospital = &mut ctx.accounts.hospital;
        hospital.active = active;
        emit!(HospitalAttested { wallet: hospital.wallet, merchant_hash: hospital.merchant_hash, active });
        Ok(())
    }

    /// A caseworker approved `amount_cents` for the case whose opaque reference hashes to `case_hash`.
    /// The grant account can only be created once, so a case can never be approved twice.
    pub fn approve_grant(ctx: Context<DecideGrant>, case_hash: [u8; 32], amount_cents: u64) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let hospital = &ctx.accounts.hospital;
        require!(hospital.active, FundError::HospitalNotAttested);
        require!(amount_cents > 0, FundError::InvalidAmount);
        require!(amount_cents <= config.max_grant_cents, FundError::OverMaxGrant);

        let grant = &mut ctx.accounts.grant;
        grant.case_hash = case_hash;
        grant.hospital = hospital.wallet;
        grant.amount_cents = amount_cents;
        grant.status = GrantStatus::Approved as u8;
        grant.rules_version = config.rules_version;
        grant.decided_at = Clock::get()?.unix_timestamp;
        grant.paid_at = 0;
        grant.nessie_payment_hash = [0u8; 32];
        grant.bump = ctx.bumps.grant;

        config.grants_approved = config.grants_approved.checked_add(1).ok_or(FundError::Overflow)?;
        config.cents_approved = config.cents_approved.checked_add(amount_cents).ok_or(FundError::Overflow)?;
        emit!(GrantDecided { case_hash, hospital: grant.hospital, amount_cents, approved: true });
        Ok(())
    }

    /// A caseworker declined the case. Recorded once, like an approval, with no amount.
    pub fn decline_grant(ctx: Context<DecideGrant>, case_hash: [u8; 32]) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let grant = &mut ctx.accounts.grant;
        grant.case_hash = case_hash;
        grant.hospital = ctx.accounts.hospital.wallet;
        grant.amount_cents = 0;
        grant.status = GrantStatus::Declined as u8;
        grant.rules_version = config.rules_version;
        grant.decided_at = Clock::get()?.unix_timestamp;
        grant.paid_at = 0;
        grant.nessie_payment_hash = [0u8; 32];
        grant.bump = ctx.bumps.grant;
        config.grants_declined = config.grants_declined.checked_add(1).ok_or(FundError::Overflow)?;
        emit!(GrantDecided { case_hash, hospital: grant.hospital, amount_cents: 0, approved: false });
        Ok(())
    }

    /// The approved grant was paid in Nessie. Records the hash of the Nessie purchase ID, once.
    pub fn mark_paid(ctx: Context<MarkPaid>, nessie_payment_hash: [u8; 32], paid_cents: u64) -> Result<()> {
        let grant = &mut ctx.accounts.grant;
        require!(grant.status == GrantStatus::Approved as u8, FundError::NotApproved);
        require!(paid_cents > 0 && paid_cents <= grant.amount_cents, FundError::InvalidAmount);
        grant.status = GrantStatus::Paid as u8;
        grant.paid_at = Clock::get()?.unix_timestamp;
        grant.nessie_payment_hash = nessie_payment_hash;
        let config = &mut ctx.accounts.config;
        config.cents_paid = config.cents_paid.checked_add(paid_cents).ok_or(FundError::Overflow)?;
        emit!(GrantPaid { case_hash: grant.case_hash, nessie_payment_hash, paid_cents });
        Ok(())
    }
}

#[repr(u8)]
pub enum GrantStatus {
    Approved = 1,
    Declined = 2,
    Paid = 3,
}

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub authority: Pubkey,
    pub max_grant_cents: u64,
    pub rules_hash: [u8; 32],
    pub rules_version: u32,
    pub grants_approved: u64,
    pub grants_declined: u64,
    pub cents_approved: u64,
    pub cents_paid: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Hospital {
    pub wallet: Pubkey,
    pub merchant_hash: [u8; 32],
    pub active: bool,
    pub attested_at: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Grant {
    pub case_hash: [u8; 32],
    pub hospital: Pubkey,
    pub amount_cents: u64,
    pub status: u8,
    pub rules_version: u32,
    pub decided_at: i64,
    pub paid_at: i64,
    pub nessie_payment_hash: [u8; 32],
    pub bump: u8,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorityOnly<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ FundError::Unauthorized)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AttestHospital<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ FundError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init, payer = authority, space = 8 + Hospital::INIT_SPACE, seeds = [HOSPITAL_SEED, wallet.key().as_ref()], bump)]
    pub hospital: Account<'info, Hospital>,
    /// CHECK: only its address is recorded; the hospital never signs.
    pub wallet: UncheckedAccount<'info>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetHospitalActive<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ FundError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [HOSPITAL_SEED, hospital.wallet.as_ref()], bump = hospital.bump)]
    pub hospital: Account<'info, Hospital>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(case_hash: [u8; 32])]
pub struct DecideGrant<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ FundError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [HOSPITAL_SEED, hospital.wallet.as_ref()], bump = hospital.bump)]
    pub hospital: Account<'info, Hospital>,
    #[account(init, payer = authority, space = 8 + Grant::INIT_SPACE, seeds = [GRANT_SEED, case_hash.as_ref()], bump)]
    pub grant: Account<'info, Grant>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MarkPaid<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ FundError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [GRANT_SEED, grant.case_hash.as_ref()], bump = grant.bump)]
    pub grant: Account<'info, Grant>,
    pub authority: Signer<'info>,
}

#[event]
pub struct RulesSet {
    pub max_grant_cents: u64,
    pub rules_hash: [u8; 32],
    pub rules_version: u32,
}

#[event]
pub struct HospitalAttested {
    pub wallet: Pubkey,
    pub merchant_hash: [u8; 32],
    pub active: bool,
}

#[event]
pub struct GrantDecided {
    pub case_hash: [u8; 32],
    pub hospital: Pubkey,
    pub amount_cents: u64,
    pub approved: bool,
}

#[event]
pub struct GrantPaid {
    pub case_hash: [u8; 32],
    pub nessie_payment_hash: [u8; 32],
    pub paid_cents: u64,
}

#[error_code]
pub enum FundError {
    #[msg("Only the fund's authority can do this")]
    Unauthorized,
    #[msg("Amount must be more than zero")]
    InvalidAmount,
    #[msg("Amount is over the fund's largest grant")]
    OverMaxGrant,
    #[msg("This hospital is not attested")]
    HospitalNotAttested,
    #[msg("Only an approved grant can be marked paid")]
    NotApproved,
    #[msg("Number overflow")]
    Overflow,
}
