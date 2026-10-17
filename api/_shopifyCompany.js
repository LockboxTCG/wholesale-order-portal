"use strict";

// Finds (or creates) the Shopify B2B company behind an order so the draft
// order can be attached to it, instead of needing someone to do that by hand.
//
// Order of matching:
//   1. The buyer's email already belongs to a company contact: use that
//      company, contact and location.
//   2. A company with the same name exists (case, spacing and punctuation
//      ignored): use it and the contact on file (the buyer's own contact if
//      their email is listed, else the main contact).
//   3. Neither: create the company (one location, same name, orders go to
//      draft for review like the existing ones) and add the buyer as its
//      main contact, linking their existing customer record if they have one.
//
// Any failure throws; the caller falls back to a plain draft order.

const ORDERING_ROLE = "Ordering only";

const CUSTOMER_BY_EMAIL = `
  query($q: String!) {
    customers(first: 1, query: $q) {
      nodes {
        id
        companyContactProfiles {
          id
          company { id name locations(first: 1) { nodes { id } } }
        }
      }
    }
  }
`;

const COMPANIES_BY_NAME = `
  query($q: String!) {
    companies(first: 10, query: $q) {
      nodes {
        id
        name
        mainContact { id }
        contacts(first: 25) { nodes { id customer { email } } }
        locations(first: 1) { nodes { id } }
      }
    }
  }
`;

const COMPANY_CREATE = `
  mutation($input: CompanyCreateInput!) {
    companyCreate(input: $input) {
      company { id name locations(first: 1) { nodes { id } } }
      userErrors { field message code }
    }
  }
`;

const ASSIGN_CUSTOMER = `
  mutation($companyId: ID!, $customerId: ID!) {
    companyAssignCustomerAsContact(companyId: $companyId, customerId: $customerId) {
      companyContact { id }
      userErrors { field message code }
    }
  }
`;

const CONTACT_CREATE = `
  mutation($companyId: ID!, $input: CompanyContactInput!) {
    companyContactCreate(companyId: $companyId, input: $input) {
      companyContact { id }
      userErrors { field message code }
    }
  }
`;

const ASSIGN_MAIN = `
  mutation($companyId: ID!, $contactId: ID!) {
    companyAssignMainContact(companyId: $companyId, companyContactId: $contactId) {
      company { id }
      userErrors { field message code }
    }
  }
`;

const CONTACT_ROLES = `
  query($id: ID!) {
    company(id: $id) { contactRoles(first: 10) { nodes { id name } } }
  }
`;

const ASSIGN_ROLE = `
  mutation($contactId: ID!, $roleId: ID!, $locationId: ID!) {
    companyContactAssignRole(companyContactId: $contactId, companyContactRoleId: $roleId, companyLocationId: $locationId) {
      companyContactRoleAssignment { id }
      userErrors { field message code }
    }
  }
`;

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

// Case, spacing and punctuation insensitive, so "Fafnir's Hoard" matches
// "Fafnirs Hoard" and "A & C" matches "A&C".
function nameKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function searchQuote(text) {
  return '"' + String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function splitName(full) {
  const parts = String(full || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  return { firstName: parts[0], ...(parts.length > 1 ? { lastName: parts.slice(1).join(" ") } : {}) };
}

function userErrorText(errors) {
  return errors.map((e) => e.message).join("; ");
}

// gql(query, variables) -> data, throwing on transport or GraphQL errors.
async function resolveCompany({ gql, companyName, contactName, contactEmail }) {
  const email = EMAIL_RE.test(String(contactEmail || "").trim()) ? String(contactEmail).trim() : "";
  const wanted = nameKey(companyName);
  if (!wanted) throw new Error("no company name to look up");

  let customerId = null;
  let status = null;
  let company = null;
  let contactId = null;

  // 1. By the buyer's email.
  if (email) {
    const data = await gql(CUSTOMER_BY_EMAIL, { q: `email:${searchQuote(email)}` });
    const customer = data.customers.nodes[0];
    if (customer) {
      customerId = customer.id;
      const profiles = customer.companyContactProfiles || [];
      const profile = profiles.find((p) => nameKey(p.company.name) === wanted) || profiles[0];
      if (profile) {
        company = profile.company;
        contactId = profile.id;
        status = "matched";
      }
    }
  }

  // 2. By company name.
  if (!company) {
    const data = await gql(COMPANIES_BY_NAME, { q: `name:${searchQuote(companyName)}` });
    const found = data.companies.nodes.find((c) => nameKey(c.name) === wanted);
    if (found) {
      company = found;
      status = "matched";
      const mine = email
        ? found.contacts.nodes.find((c) => c.customer && String(c.customer.email || "").toLowerCase() === email.toLowerCase())
        : null;
      contactId = (mine || (found.mainContact ? { id: found.mainContact.id } : null) || found.contacts.nodes[0] || {}).id || null;
    }
  }

  // 3. Create it.
  if (!company) {
    const data = await gql(COMPANY_CREATE, {
      input: {
        company: { name: companyName, note: "Created automatically from a wholesale portal order." },
        companyLocation: { name: companyName, buyerExperienceConfiguration: { checkoutToDraft: true } }
      }
    });
    const result = data.companyCreate;
    if (!result.company) throw new Error("companyCreate failed: " + userErrorText(result.userErrors));
    company = result.company;
    status = "created";
  }

  const locationId = company.locations.nodes[0] && company.locations.nodes[0].id;
  if (!locationId) throw new Error("company has no location");

  // A contact is needed to place the order: link the buyer if the company has none.
  if (!contactId) {
    if (!email) throw new Error("company has no contact and the order has no email to add one");
    let created;
    if (customerId) {
      created = (await gql(ASSIGN_CUSTOMER, { companyId: company.id, customerId })).companyAssignCustomerAsContact;
    } else {
      created = (
        await gql(CONTACT_CREATE, { companyId: company.id, input: { email, ...splitName(contactName) } })
      ).companyContactCreate;
    }
    if (!created.companyContact) throw new Error("could not add the contact: " + userErrorText(created.userErrors));
    contactId = created.companyContact.id;
    if (status === "created") {
      await gql(ASSIGN_MAIN, { companyId: company.id, contactId }).catch(() => {});
    }
  }

  // The contact needs a role at the location before a draft order will accept
  // the company. Assign "Ordering only" like the existing contacts have; an
  // already-assigned role just comes back as a harmless user error.
  const roles = (await gql(CONTACT_ROLES, { id: company.id })).company.contactRoles.nodes;
  const role = roles.find((r) => r.name === ORDERING_ROLE) || roles[0];
  if (role) {
    await gql(ASSIGN_ROLE, { contactId, roleId: role.id, locationId });
  }

  return { status, companyId: company.id, companyName: company.name, contactId, locationId };
}

module.exports = { resolveCompany, nameKey };
