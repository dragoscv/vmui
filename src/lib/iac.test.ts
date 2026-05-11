import { describe, it, expect } from "vitest";
import { cliFor, terraformFor } from "./iac";

describe("cliFor", () => {
  it("renders AWS commands with region + instance id", () => {
    expect(cliFor("start", { provider: "aws", region: "eu-west-1", providerInstanceId: "i-abc" }))
      .toBe("aws ec2 start-instances --instance-ids i-abc --region eu-west-1");
    expect(cliFor("terminate", { provider: "aws", region: "us-east-1", providerInstanceId: "i-x" }))
      .toContain("terminate-instances");
  });

  it("splits Azure {rg}/{vm} ids", () => {
    const s = cliFor("stop", { provider: "azure", region: "westeurope", providerInstanceId: "my-rg/my-vm" });
    expect(s).toContain("--resource-group my-rg");
    expect(s).toContain("--name my-vm");
    expect(s).toContain("deallocate");
  });

  it("uses --ids fallback for malformed Azure ids", () => {
    const s = cliFor("start", { provider: "azure", region: "eastus", providerInstanceId: "bad-id" });
    expect(s).toContain("--ids bad-id");
  });

  it("splits GCP {zone}/{name} ids", () => {
    const s = cliFor("reboot", { provider: "gcp", region: "us-central1", providerInstanceId: "us-central1-a/web-1" });
    expect(s).toContain("gcloud compute instances reset web-1");
    expect(s).toContain("--zone us-central1-a");
  });

  it("renders virsh for local-kvm with the name when present", () => {
    expect(cliFor("stop", { provider: "local-kvm", region: "local", providerInstanceId: "abc", name: "dev-vm" }))
      .toBe("virsh shutdown dev-vm");
  });
});

describe("terraformFor", () => {
  it("emits an aws_instance block with import hint", () => {
    const tf = terraformFor({ provider: "aws", region: "eu-west-1", providerInstanceId: "i-deadbeef", instanceType: "t3.micro", name: "web" });
    expect(tf).toMatch(/resource "aws_instance" "web"/);
    expect(tf).toContain('instance_type = "t3.micro"');
    expect(tf).toContain("terraform import aws_instance.web i-deadbeef");
  });

  it("sanitizes resource names with non-identifier characters", () => {
    const tf = terraformFor({ provider: "aws", region: "us-east-1", providerInstanceId: "i-1", name: "weird name.1" });
    expect(tf).toMatch(/resource "aws_instance" "weird_name_1"/);
  });

  it("emits google_compute_instance with zone + image defaults", () => {
    const tf = terraformFor({ provider: "gcp", region: "us-central1", providerInstanceId: "us-central1-a/web" });
    expect(tf).toContain('zone         = "us-central1-a"');
    expect(tf).toContain("image = ");
  });
});
