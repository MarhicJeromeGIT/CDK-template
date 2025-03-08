import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecspatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Use an existing VPC
    const vpc = ec2.Vpc.fromLookup(this, 'CounterVpc', {
      vpcName: 'jenkins-vpc'
    });

    // Create an ECS cluster
    const cluster = new ecs.Cluster(this, 'CounterCluster', {
      vpc: vpc
    });

    // Define the Fargate service
    // See https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_ecs_patterns.ApplicationLoadBalancedFargateService.html
    const fargateService = new ecspatterns.ApplicationLoadBalancedFargateService(this, 'CounterFargateService', {
      cluster: cluster, // Required
      memoryLimitMiB: 512,
      desiredCount: 1,
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset('../back'), // Path to your Dockerfile
        containerPort: 8080, // 👈 This ensures traffic goes to your container on port 8080
      },
      publicLoadBalancer: true, // Default is false
      healthCheckGracePeriod: cdk.Duration.seconds(60), // Adjust as needed
      minHealthyPercent: 100, // Ensure all tasks are healthy before reducing count
      maxHealthyPercent: 200 // Allow up to double the desired count during deployments
    });

    // Output the ALB DNS name
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: fargateService.loadBalancer.loadBalancerDnsName,
      description: 'The DNS name of the load balancer',
    });
  }
}
