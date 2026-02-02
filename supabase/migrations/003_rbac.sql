-- RBAC (Role-Based Access Control) Database Schema
-- Migration: 003_rbac.sql
-- Description: Organizations, departments, roles, memberships, and security levels

-- Organizations Table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Departments Table (hierarchical structure with parent_id)
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    parent_id UUID REFERENCES departments(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT unique_dept_name_per_org UNIQUE (org_id, name)
);

-- Roles Table
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    permissions JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT unique_role_name_per_org UNIQUE (org_id, name)
);

-- Organization Memberships Table
CREATE TABLE org_memberships (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    PRIMARY KEY (user_id, org_id)
);

-- Security Levels Table
CREATE TABLE security_levels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    level INTEGER NOT NULL,
    color VARCHAR(7),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT unique_level_per_org UNIQUE (org_id, level),
    CONSTRAINT unique_security_name_per_org UNIQUE (org_id, name),
    CONSTRAINT valid_hex_color CHECK (color ~ '^#[0-9A-Fa-f]{6}$' OR color IS NULL)
);

-- Indexes for organizations
CREATE INDEX idx_organizations_slug ON organizations(slug);

-- Indexes for departments
CREATE INDEX idx_departments_org_id ON departments(org_id);
CREATE INDEX idx_departments_parent_id ON departments(parent_id);
CREATE INDEX idx_departments_org_parent ON departments(org_id, parent_id);

-- Indexes for roles
CREATE INDEX idx_roles_org_id ON roles(org_id);
CREATE INDEX idx_roles_permissions ON roles USING GIN (permissions);

-- Indexes for org_memberships
CREATE INDEX idx_org_memberships_user_id ON org_memberships(user_id);
CREATE INDEX idx_org_memberships_org_id ON org_memberships(org_id);
CREATE INDEX idx_org_memberships_department_id ON org_memberships(department_id);
CREATE INDEX idx_org_memberships_role_id ON org_memberships(role_id);
CREATE INDEX idx_org_memberships_org_dept ON org_memberships(org_id, department_id);

-- Indexes for security_levels
CREATE INDEX idx_security_levels_org_id ON security_levels(org_id);
CREATE INDEX idx_security_levels_level ON security_levels(org_id, level);

-- Comments for documentation
COMMENT ON TABLE organizations IS 'Organizations that users can belong to';
COMMENT ON TABLE departments IS 'Hierarchical department structure within organizations';
COMMENT ON TABLE roles IS 'Roles with JSONB permissions assigned to users within organizations';
COMMENT ON TABLE org_memberships IS 'User membership in organizations with department and role assignments';
COMMENT ON TABLE security_levels IS 'Security clearance levels for organizations';

COMMENT ON COLUMN departments.parent_id IS 'Self-referencing foreign key for department hierarchy';
COMMENT ON COLUMN roles.permissions IS 'JSONB object containing permission definitions';
COMMENT ON COLUMN security_levels.level IS 'Numeric security level (higher = more access)';
COMMENT ON COLUMN security_levels.color IS 'Hex color code for UI display (e.g., #FF0000)';
