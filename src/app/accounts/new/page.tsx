import Link from "next/link";
import { ArrowLeft, Cloud, Apple, MonitorCog } from "lucide-react";
import { AwsAccountConnect } from "@/components/accounts/aws-account-connect";
import { ScalewayAccountConnect } from "@/components/accounts/scaleway-account-connect";
import { LocalKvmAccountConnect } from "@/components/accounts/local-kvm-account-connect";
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
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="aws">
            <Cloud className="mr-1.5 h-3.5 w-3.5" /> Amazon Web Services
          </TabsTrigger>
          <TabsTrigger value="scaleway">
            <Apple className="mr-1.5 h-3.5 w-3.5" /> Scaleway · Apple Silicon
          </TabsTrigger>
          <TabsTrigger value="local-kvm">
            <MonitorCog className="mr-1.5 h-3.5 w-3.5" /> Local · KVM
          </TabsTrigger>
        </TabsList>
        <TabsContent value="aws" className="pt-4">
          <AwsAccountConnect />
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
