-- Add 'resident' to org_role enum (PostgreSQL)
ALTER TYPE "public"."org_role" ADD VALUE IF NOT EXISTS 'resident';
