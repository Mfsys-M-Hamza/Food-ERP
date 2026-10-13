"use server";

import { refresh } from "next/cache";
import { requireContext } from "@/server/core/context";
import { runAction, type ActionResult } from "@/server/core/action";
import {
  searchCustomers,
  createCustomer,
  updateCustomer,
  addCustomerAddress,
  deleteCustomerAddress,
  type CustomerSummary,
} from "./service";

export async function searchCustomersAction(q: string): Promise<ActionResult<CustomerSummary[]>> {
  return runAction(async () => {
    const ctx = await requireContext();
    return searchCustomers(ctx, String(q ?? "").slice(0, 60));
  });
}

export async function createCustomerAction(input: unknown, address?: unknown): Promise<ActionResult<CustomerSummary>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const c = await createCustomer(ctx, input, address);
    refresh();
    return c;
  }, "Customer added");
}

export async function updateCustomerAction(id: string, input: unknown): Promise<ActionResult<CustomerSummary>> {
  return runAction(async () => {
    const ctx = await requireContext();
    const c = await updateCustomer(ctx, String(id), input);
    refresh();
    return c;
  }, "Customer saved");
}

export async function addAddressAction(customerId: string, input: unknown): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await addCustomerAddress(ctx, String(customerId), input);
    refresh();
    return undefined;
  }, "Address added");
}

export async function deleteAddressAction(addressId: string): Promise<ActionResult<undefined>> {
  return runAction(async () => {
    const ctx = await requireContext();
    await deleteCustomerAddress(ctx, String(addressId));
    refresh();
    return undefined;
  }, "Address removed");
}
