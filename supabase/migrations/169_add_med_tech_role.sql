-- Migration 169: Add med_tech role to app_role enum
-- Supports the dedicated Med-Tech Shift Cockpit at /med-tech

ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'med_tech';
