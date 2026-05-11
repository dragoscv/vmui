import Link from "next/link";
import { ArrowLeft, Cloud, Apple, MonitorCog, Droplets, Server } from "lucide-react";
import { AwsAccountConnect } from "@/components/accounts/aws-account-connect";
import { ScalewayAccountConnect } from "@/components/accounts/scaleway-account-connect";
import { LocalKvmAccountConnect } from "@/components/accounts/local-kvm-account-connect";
import { AzureAccountConnect } from "@/components/accounts/azure-account-connect";
import { GcpAccountConnect } from "@/components/accounts/gcp-account-connect";
import { DigitalOceanAccountConnect } from "@/components/accounts/digitalocean-account-connect";
import { HetznerAccountConnect } from "@/components/accounts/hetzner-account-connect";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export default function NewAccountPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/accounts">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect a cloud account</h1>
        <p className="text-sm text-muted">
          Pick a provider, then choose how to authenticate. Credentials are encrypted with AES-256-GCM using your
          local master key and never leave this machine.
        </p>
      </div>
      <Tabs defaultValue="aws" className="w-full">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="aws">
            <Cloud className="mr-1.5 h-3.5 w-3.5" /> AWS
          </TabsTrigger>
          <TabsTrigger value="azure">
            <Cloud className="mr-1.5 h-3.5 w-3.5" /> Azure
          </TabsTrigger>
          <TabsTrigger value="gcp">
            <Cloud className="mr-1.5 h-3.5 w-3.5" /> GCP
          </TabsTrigger>
          <TabsTrigger value="digitalocean">
            <Droplets className="mr-1.5 h-3.5 w-3.5" /> DigitalOcean
          </TabsTrigger>
          <TabsTrigger value="hetzner">
            <Server className="mr-1.5 h-3.5 w-3.5" /> Hetzner
          </TabsTrigger>
          <TabsTrigger value="scaleway">
            <Apple className="mr-1.5 h-3.5 w-3.5" /> Scaleway
          </TabsTrigger>
          <TabsTrigger value="local-kvm">
            <MonitorCog className="mr-1.5 h-3.5 w-3.5" /> Local
          </TabsTrigger>
        </TabsList>
        <TabsContent value="aws" className="pt-4">
          <AwsAccountConnect />
        </TabsContent>
        <TabsContent value="azure" className="pt-4">
          <AzureAccountConnect />
        </TabsContent>
        <TabsContent value="gcp" className="pt-4">
          <GcpAccountConnect />
        </TabsContent>
        <TabsContent value="digitalocean" className="pt-4">
          <DigitalOceanAccountConnect />
        </TabsContent>
        <TabsContent value="hetzner" className="pt-4">
          <HetznerAccountConnect />
        </TabsContent>
        <TabsContent value="scaleway" className="pt-4">
          <ScalewayAccountConnect />
        </TabsContent>
        <TabsContent value="local-kvm" className="pt-4">
          <LocalKvmAccountConnect />
        </TabsContent>
      </Tabs>
    </div>
  );
}
