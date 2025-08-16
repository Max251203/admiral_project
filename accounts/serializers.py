from rest_framework import serializers
from django.contrib.auth.models import User
from .models import Profile

class RegisterSerializer(serializers.ModelSerializer):
    email = serializers.EmailField(required=True)
    password = serializers.CharField(write_only=True)
    login = serializers.CharField(write_only=True)
    class Meta:
        model = User
        fields = ("username","email","password","login")
    def create(self, data):
        user = User.objects.create_user(username=data["username"], email=data["email"], password=data["password"])
        user.profile.login = data["login"]; user.profile.save()
        return user

class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = Profile
        fields = "__all__"